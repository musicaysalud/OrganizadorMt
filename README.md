# MusiCare Mobile — Instrucciones de instalación

## Qué es
App companion para MusiCare Desktop. Grabás audios en tu Samsung A12,
se sincronizan con Google Drive, y MusiCare Desktop los lee automáticamente
desde tus carpetas de pacientes.

---

## Paso 1 — Crear credencial Google (una sola vez)

1. Ir a https://console.cloud.google.com
2. Crear proyecto nuevo (ej: "MusiCare Mobile")
3. En "APIs y servicios" → "Biblioteca" → buscar "Google Drive API" → Habilitar
4. En "APIs y servicios" → "Credenciales" → "Crear credencial" → "ID de cliente OAuth 2.0"
5. Tipo: **Aplicación web**
6. Agregar en "Orígenes autorizados de JavaScript": la URL donde hospedarás la app
7. Agregar en "URIs de redireccionamiento autorizados": la misma URL
8. Copiar el **Client ID** generado

9. Abrir `js/drive.js` y reemplazar:
   ```
   const GOOGLE_CLIENT_ID = 'TU_CLIENT_ID_AQUI.apps.googleusercontent.com';
   ```
   con tu Client ID real.

---

## Paso 2 — Hostear la app

### Opción A — GitHub Pages (gratuito, recomendado)
1. Crear repositorio en GitHub (puede ser privado)
2. Subir todos los archivos
3. En Settings → Pages → Branch: main → Save
4. La URL será: `https://TU_USUARIO.github.io/NOMBRE_REPO/`
5. Esa URL va en las credenciales de Google (paso 1, punto 6 y 7)

### Opción B — Netlify (gratuito)
1. Ir a netlify.com, arrastrar la carpeta del proyecto
2. Netlify te da una URL automáticamente

---

## Paso 3 — Instalar en el Samsung A12

1. Abrir Chrome en el teléfono
2. Ir a la URL de la app
3. Chrome mostrará "Agregar a pantalla de inicio" (o menú ⋮ → Instalar app)
4. Confirmar — aparece el ícono como una app normal

---

## Paso 4 — Configurar

1. Abrir la app → pestaña ⚙ Ajustes
2. Presionar "Conectar con Google" → elegir tu cuenta de Drive
3. Volver a la pantalla principal
4. En el selector de carpeta → escribir el nombre de una carpeta de paciente → "+ Agregar"
5. La carpeta se creará automáticamente en Drive la primera vez que subas un audio

---

## Cómo se integra con MusiCare Desktop

En MusiCare Desktop cada paciente tiene una carpeta linkeada.
Si esa carpeta está sincronizada con Google Drive (via el cliente de escritorio de Drive),
los audios que subas desde el teléfono aparecerán automáticamente
en la pestaña "Audios" del paciente cuando abras MusiCare.

**Flujo:**
```
Samsung A12
  → grabás audio
  → se sube a Drive/CarpetaPaciente/audio.mp4
PC Windows (Drive sincronizado)
  → C:\Users\...\Google Drive\CarpetaPaciente\audio.mp4 aparece
MusiCare Desktop
  → la carpeta del paciente incluye ese archivo
  → aparece en pestaña "Audios" con soporte de marcadores
```

---

## Módulos futuros (arquitectura preparada)

La app está diseñada para agregar pantallas nuevas fácilmente.
Para agregar "Documentos" o "Cronograma":

1. Agregar un botón en `#bottom-nav` en `index.html`
2. Agregar `<div id="screen-NOMBRE" class="screen">` en `index.html`
3. Agregar `NOMBRE: indice` en el `map` dentro de `goScreen()` en `app.js`
4. Crear lógica en un nuevo archivo JS (ej: `js/documents.js`)

---

## Soporte de formatos de audio

| Formato | Android Chrome | MusiCare Desktop |
|---------|---------------|------------------|
| MP4/AAC | ✅ | ✅ |
| WebM/Opus | ✅ | ✅ |
| OGG/Opus | ✅ | ✅ |

La app detecta automáticamente el mejor formato soportado por el dispositivo.
