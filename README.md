# net-infra-query

Frontend for **[altyapi.frudotz.com](https://altyapi.frudotz.com)** — Türk Telekom altyapı sorgulama.
Static site (no build step) served by GitHub Pages; backend: [`niq-api`](https://github.com/frudotz/niq-api).

## Structure

| file | role |
|------|------|
| `index.html` | markup, CSP, API base (`<meta name="niq-api-base">`) |
| `css/index.css` | design tokens + components (dark/light) |
| `js/boot.js` | pre-paint theme, Turnstile callback bridge |
| `js/app.js` | entry: form, tabs, last query, export actions |
| `js/api.js` | session (Turnstile → token, auto-renew on 401), timeouts, errors |
| `js/address-form.js` | il → … → daire cascade with stale-response protection and retry |
| `js/map-picker.js` | lazy-loaded Leaflet map, reverse geocode → cascade |
| `js/result-model.js` | API result → view model (single normalisation point) |
| `js/result-view.js` | empty / loading / error / success states |
| `js/export-image.js` | "Görseli Kopyala": canvas share card → clipboard, download fallback |
| `sw.js` | network-first service worker (offline fallback only) |

## Development

```sh
npm install
npm run serve      # http://127.0.0.1:4173
npm run lint
npm test           # unit tests (view model, matching, text wrapping)
npm run test:e2e   # Playwright: UI states, export, a11y, mobile, map, SW;
                   # full-stack tests also run if ../niq-api is installed
```

Browser tests serve all third-party assets locally (Turnstile stub, Inter from
`@fontsource/inter`, Leaflet from `node_modules`), so they run offline.
