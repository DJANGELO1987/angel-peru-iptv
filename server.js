/* Angel Perú IPTV — Creado por Angel Perú */
'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const ipaddr = require('ipaddr.js');
const dns = require('node:dns');
const crypto = require('node:crypto');
const path = require('node:path');
const { Agent, fetch } = require('undici');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_TOKEN = process.env.AP_ACCESS_TOKEN || '';
const MAX_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;
const allowedHosts = (process.env.ALLOWED_SOURCE_HOSTS || '')
  .split(',')
  .map(x => x.trim().toLowerCase())
  .filter(Boolean);
const allowHttp = process.env.ALLOW_HTTP_SOURCES === 'true';

if (API_TOKEN.length < 32) {
  console.error('Configuración inválida: AP_ACCESS_TOKEN debe tener al menos 32 caracteres aleatorios.');
  process.exit(1);
}
if (allowedHosts.length === 0) {
  console.error('Configuración incompleta: define ALLOWED_SOURCE_HOSTS con los dominios IPTV autorizados.');
  process.exit(1);
}

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  referrerPolicy: { policy: 'no-referrer' }
}));
app.use(express.json({ limit: '8kb', strict: true }));
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Demasiadas importaciones. Espera 15 minutos e inténtalo de nuevo.' }
});

function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function requireToken(req, res, next) {
  const header = req.headers.authorization || '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!safeEqual(supplied, API_TOKEN)) return res.status(401).json({ error: 'Clave API incorrecta o ausente.' });
  next();
}
function hostAllowed(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  return allowedHosts.some(entry => h === entry || h.endsWith('.' + entry));
}
function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === 'ipv6' && parsed.isIPv4MappedAddress()) parsed = parsed.toIPv4Address();
    return parsed.range() === 'unicast';
  } catch (_) {
    return false;
  }
}
async function validateSource(raw) {
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error('La dirección URL no es válida.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se permiten direcciones HTTP o HTTPS.');
  if (url.protocol === 'http:' && !allowHttp) throw new Error('El servidor está configurado para aceptar solo HTTPS. Activa HTTP únicamente si tu proveedor autorizado no ofrece HTTPS; las credenciales viajarían sin cifrar.');
  if (url.username || url.password) throw new Error('No incluyas usuario o contraseña en la parte de autenticación de la URL. Usa el formato de URL entregado por tu proveedor autorizado.');
  if (!hostAllowed(url.hostname)) throw new Error('Dominio no autorizado. Añade el dominio exacto a ALLOWED_SOURCE_HOSTS en la configuración del servidor.');
  const literal = ipaddr.isValid(url.hostname);
  if (literal) {
    if (!isPublicAddress(url.hostname)) throw new Error('La dirección IP no es pública y está bloqueada.');
  } else {
    const records = await dns.promises.lookup(url.hostname, { all: true, verbatim: true });
    if (!records.length || records.some(record => !isPublicAddress(record.address))) {
      throw new Error('El dominio resuelve a una dirección no pública y se ha bloqueado por seguridad.');
    }
  }
  return url;
}
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, records) => {
    if (err) return callback(err);
    if (!records.length || records.some(r => !isPublicAddress(r.address))) {
      const e = new Error('Destino de red no público bloqueado.');
      e.code = 'EACCES';
      return callback(e);
    }
    const chosen = records[0];
    if (options && options.all) callback(null, records);
    else callback(null, chosen.address, chosen.family);
  });
}
async function readLimited(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BYTES) throw new Error('La lista supera el límite de 4 MB.');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        throw new Error('La lista supera el límite de 4 MB.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    try { reader.releaseLock(); } catch (_) {}
  }
  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}
async function fetchPlaylist(initialUrl) {
  let current = initialUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await validateSource(current);
    const dispatcher = new Agent({ connect: { lookup: safeLookup }, headersTimeout: TIMEOUT_MS, bodyTimeout: TIMEOUT_MS });
    let response;
    try {
      response = await fetch(url, {
        method: 'GET',
        dispatcher,
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'Accept': 'application/vnd.apple.mpegurl, audio/x-mpegurl, text/plain, */*',
          'User-Agent': 'AngelPeruIPTV/2.0 playlist-import'
        }
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location || hop === MAX_REDIRECTS) throw new Error('Redirección no válida o demasiadas redirecciones.');
        current = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`El proveedor respondió HTTP ${response.status}.`);
      }
      const content = await readLimited(response);
      if (!content.trim() || !content.includes('#EXTM3U')) throw new Error('La respuesta no parece una lista M3U válida (#EXTM3U no encontrado).');
      return { content, baseUrl: url.href };
    } finally {
      await dispatcher.close().catch(() => {});
    }
  }
  throw new Error('No se pudo completar la importación.');
}

app.get('/api/health', (_req, res) => res.json({ ok: true, app: 'Angel Perú IPTV', version: '2.0.0' }));
app.post('/api/import', importLimiter, requireToken, async (req, res) => {
  const source = req.body && req.body.url;
  if (typeof source !== 'string' || source.length > 4096) return res.status(400).json({ error: 'Envía una URL válida de hasta 4096 caracteres.' });
  try {
    const result = await fetchPlaylist(source);
    return res.json(result);
  } catch (err) {
    // No registrar URL, parámetros ni credenciales del proveedor.
    const known = /HTTP \d+|URL|HTTPS|HTTP únicamente|Dominio|pública|4 MB|M3U|Redirección|credenciales|proveedor/i.test(err.message);
    return res.status(400).json({ error: known ? err.message : 'No se pudo conectar con la fuente. Comprueba disponibilidad, HTTPS y dominio autorizado.' });
  }
});

app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  etag: true,
  maxAge: '1h'
}));
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'Solicitud demasiado grande.' });
  return res.status(400).json({ error: 'Solicitud no válida.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Angel Perú IPTV 2.0 escuchando en el puerto ${PORT}`);
});
