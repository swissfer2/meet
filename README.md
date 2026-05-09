# meet

Sidecar web para Google Meet con traducción en vivo usando OpenAI Realtime.

## Qué hace

- Captura el audio de una pestaña de Google Meet desde el navegador
- Envía ese audio a una sesión Realtime con `gpt-realtime-2`
- Reproduce voz traducida en tiempo real
- Muestra transcript incremental del audio original y de la traducción
- Permite elegir idioma origen, idioma destino y voz de salida

## Ejecutar

```bash
npm install
npm run dev:web
```

Luego abre [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Variables de entorno

Puedes copiar [.env.example](/Users/fernandobecerrafarelo/Documents/Playground/.env.example) y definir:

```bash
HOST=127.0.0.1
PORT=3000
OPENAI_API_KEY=tu_api_key
OPENAI_REALTIME_MODEL=gpt-realtime-2
OPENAI_REALTIME_API_PATH=/v1/realtime/calls
OPENAI_REALTIME_VOICE=sage
OPENAI_TRANSCRIPTION_MODEL=gpt-4o-mini-transcribe
```

## Flujo

1. Arranca `npm run dev:web`.
2. Abre `http://127.0.0.1:3000`.
3. Pulsa `Iniciar sidecar`.
4. Selecciona la pestaña de Google Meet.
5. Activa la opción de compartir el audio de la pestaña.
6. Escucha la voz traducida y sigue los subtítulos originales y traducidos.

## Estructura

- [server.js](/Users/fernandobecerrafarelo/Documents/Playground/src/server.js): servidor HTTP local y proxy seguro hacia OpenAI Realtime
- [meet-sidecar.html](/Users/fernandobecerrafarelo/Documents/Playground/src/meet-sidecar.html): interfaz del sidecar
- [meet-sidecar.js](/Users/fernandobecerrafarelo/Documents/Playground/src/meet-sidecar.js): captura de pantalla, WebRTC y render de subtítulos
- [meet-sidecar.css](/Users/fernandobecerrafarelo/Documents/Playground/src/meet-sidecar.css): estilos de la experiencia

## Notas

- La API key solo se usa en el servidor local.
- Si el navegador no detecta audio, vuelve a compartir la pestaña y asegúrate de marcar el audio de la pestaña.
- El navegador integrado de algunas herramientas puede bloquear `127.0.0.1`; en ese caso abre la URL en tu navegador habitual.
