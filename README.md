# Angel Perú IPTV 2.0 — Creado por Angel Perú

Backend privado de importación de listas M3U. La aplicación sirve el frontend y la API desde el mismo dominio para evitar CORS entre la interfaz y el backend.

## Qué incluye
- Frontend HTML/CSS/JS sin frameworks.
- API `POST /api/import` protegida con token Bearer.
- Lista permitida de dominios (`ALLOWED_SOURCE_HOSTS`).
- Bloqueo de destinos IP privados/locales y validación DNS en la conexión.
- Redirecciones limitadas y revalidadas.
- Límite de 4 MB, timeout de 15 segundos y rate limit.
- No registra URLs, parámetros ni credenciales del proveedor.
- No retransmite vídeo ni actúa como proxy HLS/DASH.

## Requisitos
Node.js 20 o superior para ejecutar localmente. Para desplegar en Render no necesitas instalar Node en el teléfono: Render lo instala durante el despliegue.

## Prueba local (opcional)
1. Instala Node.js 20+ en una computadora.
2. En esta carpeta ejecuta `npm install`.
3. Copia `.env.example` a `.env` y completa las variables.
4. Ejecuta `npm start` y abre `http://localhost:3000`.

En Windows PowerShell puedes generar una clave con:
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`

No publiques ni compartas tu `.env`. No subas la clave API a GitHub.

## Publicar gratis en Render (paso a paso)
> El plan Free sirve para pruebas. Render indica que sus instancias gratuitas tienen limitaciones y no recomienda usarlas para producción. Pueden suspenderse al estar inactivas, por lo que la primera petición puede tardar. Consulta el precio y límites actuales antes de publicar.

1. Descarga y descomprime `angel-peru-iptv-2.zip`.
2. Crea una cuenta en GitHub y un repositorio privado llamado `angel-peru-iptv`.
3. Sube todos los archivos y carpetas de este proyecto al repositorio. La estructura debe conservar `public/index.html`.
4. Crea una cuenta en Render y pulsa **New → Web Service**.
5. Conecta GitHub y selecciona el repositorio `angel-peru-iptv`.
6. Configura:
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free para pruebas
7. En **Environment**, añade:
   - `AP_ACCESS_TOKEN`: una clave aleatoria larga (32 bytes o más).
   - `ALLOWED_SOURCE_HOSTS`: dominio(s) autorizado(s), sin `http://`, puerto ni ruta; separados por comas.
   - `ALLOW_HTTP_SOURCES`: `false` si el proveedor tiene HTTPS.
8. Pulsa **Create Web Service** y espera el despliegue.
9. Abre la URL `https://tu-servicio.onrender.com/api/health`. Debe responder JSON con `"ok": true`.
10. Abre `https://tu-servicio.onrender.com`, pulsa **Importar lista**, pega la clave API y la URL M3U autorizada.

### Si tu proveedor solo ofrece HTTP
La captura inicial muestra una URL HTTP. El tráfico entre Render y ese proveedor podría viajar sin cifrado. Solo si tienes autorización y aceptas ese riesgo, cambia `ALLOW_HTTP_SOURCES` a `true` en Render y vuelve a desplegar. No reutilices contraseñas importantes y consulta al proveedor si ofrece HTTPS. El acceso entre tu móvil y Render sigue usando HTTPS.

## Configurar dominios permitidos
`ALLOWED_SOURCE_HOSTS` es una barrera deliberada contra el uso del backend como proxy abierto. Añade solo el dominio del proveedor que tienes derecho a utilizar. Ejemplo ficticio:
`ALLOWED_SOURCE_HOSTS=iptv-ejemplo.com,api.iptv-ejemplo.net`

No añadas `*`, direcciones IP privadas ni dominios de terceros desconocidos. Si el proveedor redirige a otro dominio legítimo, ese dominio también debe estar autorizado.

## Uso de la clave API
La clave se introduce en el formulario de importación. El frontend la conserva solo en `sessionStorage` durante esa sesión del navegador; no se guarda en el repositorio ni en localStorage. No compartas la clave. Si se filtra, genera otra y actualiza Render.

## Limitaciones reales
- CORS del navegador se evita para la descarga de la lista porque el backend hace la solicitud servidor-a-servidor.
- Esto no soluciona automáticamente CORS, autenticación, restricciones IP, DRM ni códecs de los streams de vídeo.
- Los enlaces internos relativos de una M3U se resuelven respecto de la URL de la lista, pero su reproducción posterior depende de que el proveedor permita el acceso desde el navegador.
- El backend no guarda listas ni contraseñas de proveedor en una base de datos.
- No usar para acceder a contenido sin autorización.

## Solución de problemas
- `401`: clave API incorrecta.
- `Dominio no autorizado`: añade el host correcto a `ALLOWED_SOURCE_HOSTS`.
- `solo HTTPS`: confirma si el proveedor ofrece HTTPS; HTTP requiere habilitación consciente.
- `M3U no encontrada`: revisa que la URL devuelva una lista con `#EXTM3U`, no una página de inicio de sesión HTML.
- `429`: espera 15 minutos antes de volver a importar.
- Servicio dormido: en el plan gratuito espera a que Render despierte la instancia.

## Autoría
Angel Perú IPTV — Creado por Angel Perú.
