# HANDOFF — Familiar Weather

**Status:** v1 shipped and pushed to https://github.com/THEROCKSSS/familiar-weather.
**Last update:** 2026-09-30 (initial build session, Familiar).

## What this is
Self-hosted weather website cloning Weather Extension's free+Pro UX on free keyless APIs
(Open-Meteo, RainViewer, Nominatim, OSM tiles). Static frontend + stdlib `server.py`.
Runnable via `python server.py`, Podman image, or `tailscale serve --bg 8123`.

## Verified state (real evidence)
- `node --check app.js` → OK
- `scripts/verify_render.py` (headless Chromium): 24 hourly points, 10 day rows, 4 metrics,
  brief renders, °F→°C toggle changes temp (56F→13C), search "Chicago" switches place + radar,
  mobile media queries active, **0 JS errors**.
- Radar basemap: only `tile.openstreetmap.org` + `tilecache.rainviewer.com` hosts (keyless).
- No element overlap in header (bounding-box checked).

## Gotchas
- Open-Meteo rejects duplicate `forecast_days` params (400, HTML body) — one only.
- RainViewer `host` is top-level in weather-maps.json, NOT per frame.
- CARTO basemaps now watermark "API KEY REQUIRED" — do not use; OSM tiles + CSS filter instead.
- Nominatim: 1 req/s — search is debounced 500ms + aborted on new query.
- Playwright `networkidle` times out on radar tiles — use `domcontentloaded` + selector waits.

## Next steps (documented in README upgrade path)
US alerts via api.weather.gov · air quality panel · PWA/offline · multi-location grid.

## Local run
`cd projects/familiar-weather && python server.py` → http://127.0.0.1:8123
