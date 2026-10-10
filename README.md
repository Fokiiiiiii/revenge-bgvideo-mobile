# BgVideo Mobile

Independent JavaScript-only plugin repository for Revenge Next on Android.

Build with Bun: bun install, then bun run build. The JS bundle is generated under plugins/bgvideo-mobile/build/js/.

The plugin uses Revenge's mobile API and dynamic module lookup. Target-app preview and playback still need validation with the latest release.

## v1.0.10

- Mounted chat components subscribe to settings changes; root/background fallback selection follows React ancestry.
- Preview and background share viewport positioning calculations, including the excess width of landscape images.
- Video X/Y changes update the HTML source, and WebView navigation lock events receive a native response.
- Concurrent identical media resolutions share downloads. HEAD requests time out, and actual decoded cache size is checked before writing.

Validation: 26 Bun tests, TypeScript, targeted Biome checks, and the production build pass. Android rendering, playback, and restart restoration are not yet verified.

The current FileModule cache path is capped at 32 MiB per file; unknown-size or larger sources play directly. The Base64 download path cannot guarantee peak memory when the server reports an incorrect size. Same-URL freshness and clearing cache during an active download remain limitations.

## Install/update

Add this repository to Revenge Next's plugin repositories:

`https://raw.githubusercontent.com/Fokiiiiiii/revenge-bgvideo-mobile/main/plugin-dist`
