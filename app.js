/* Familiar Weather — free-data weather app.
   Sources: Open-Meteo (forecast), RainViewer (radar), Nominatim (search). No API keys. */
"use strict";

/* ---------- state ---------- */
const LS = {
  get(k, d) { try { const v = localStorage.getItem("fw." + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("fw." + k, JSON.stringify(v)); } catch {} },
};
let state = {
  units: LS.get("units", "imperial"),          // 'imperial' = °F, 'metric' = °C
  theme: LS.get("theme", "dark"),
  places: LS.get("places", []),                // [{name, lat, lon}]
  active: LS.get("active", null),              // active place
  data: null, hourly: null, daily: null,
  radar: { frames: [], idx: 0, timer: null, playing: false },
};
if (!state.active && !state.places.length) {
  state.active = { name: "Denver, Colorado", lat: 39.7392, lon: -104.8608 };
}

const $ = (s) => document.querySelector(s);

/* ---------- WMO weather codes ---------- */
const WMO = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"], 3: ["Overcast", "☁️"],
  45: ["Fog", "🌫️"], 48: ["Depositing fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Dense drizzle", "🌧️"],
  56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
  61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "❄️"],
  80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌧️"], 82: ["Violent showers", "⛈️"],
  85: ["Snow showers", "🌨️"], 86: ["Heavy snow showers", "❄️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Storm w/ hail", "⛈️"], 99: ["Storm w/ hail", "⛈️"],
};
const wmo = (c) => WMO[c] || ["Unknown", "❔"];

/* ---------- units ---------- */
const tempU = () => state.units === "imperial" ? "fahrenheit" : "celsius";
const windU = () => state.units === "imperial" ? "mph" : "kmh";
const T = (n) => Math.round(n) + "°";

/* ---------- fetch with retry ---------- */
async function getJSON(url, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } catch (e) { lastErr = e; await new Promise(r => setTimeout(r, 800 * (i + 1))); }
  }
  throw lastErr;
}

/* ---------- forecast load ---------- */
async function loadForecast() {
  const p = state.active;
  $("#current-status").className = "panel-status";
  $("#current-status").textContent = "Loading forecast for " + p.name + "…";
  $("#current-status").hidden = false;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "auto";
  const url = "https://api.open-meteo.com/v1/forecast"
    + `?latitude=${p.lat}&longitude=${p.lon}`
    + "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,pressure_msl,is_day,precipitation"
    + "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,is_day&forecast_hours=24"
    + "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset&forecast_days=10"
    + `&temperature_unit=${tempU()}&wind_speed_unit=${windU()}&timezone=${encodeURIComponent(tz)}`;
  try {
    const d = await getJSON(url);
    state.data = d.current; state.hourly = d.hourly; state.daily = d.daily;
    state.timezone = d.timezone_abbreviation;
    renderCurrent(); renderBrief(); renderHourly(); renderDaily();
    $("#current-status").hidden = true;
  } catch (e) {
    const s = $("#current-status");
    s.hidden = false; s.className = "panel-status err";
    s.textContent = "Could not reach Open-Meteo (" + e.message + "). Check connection, then reload. Data areas stay honest — no invented numbers.";
  }
}

/* ---------- render: current ---------- */
function renderCurrent() {
  const c = state.data, p = state.active;
  const [desc, ico] = wmo(c.weather_code);
  const dir = compass(c.wind_direction_10m);
  $("#current-body").innerHTML = `
    <div class="current-grid">
      <div class="current-hero">
        <div class="current-place">${esc(p.name)}</div>
        <div class="current-desc">${ico} ${desc} · updated ${fmtTime(c.time)}${state.timezone ? " (" + state.timezone + ")" : ""}</div>
        <div class="current-temp">${Math.round(c.temperature_2m)}<span class="unit">${state.units === "imperial" ? "F" : "C"}</span></div>
        <div class="current-feels">Feels like ${T(c.apparent_temperature)}</div>
      </div>
      <div class="current-metrics">
        <div class="metric"><div class="m-label">Wind</div><div class="m-value">${Math.round(c.wind_speed_10m)} ${windU() === "mph" ? "mph" : "km/h"} ${dir}</div></div>
        <div class="metric"><div class="m-label">Humidity</div><div class="m-value">${c.relative_humidity_2m}%</div></div>
        <div class="metric"><div class="m-label">Pressure</div><div class="m-value">${Math.round(c.pressure_msl)} hPa</div></div>
        <div class="metric"><div class="m-label">Precip now</div><div class="m-value">${c.precipitation} mm</div></div>
      </div>
    </div>`;
}

/* ---------- render: daily brief (their PAID "Daily Brief", free here) ---------- */
function renderBrief() {
  const h = state.hourly, d = state.daily, panel = $("#brief-panel");
  // rain window in next 24h
  let rainWin = null;
  for (let i = 0; i < Math.min(24, h.time.length); i++) {
    if ((h.precipitation_probability?.[i] ?? 0) >= 40 || (h.precipitation?.[i] ?? 0) > 0.2) {
      rainWin = rainWin || h.time[i]; break;
    }
  }
  const today = d.weather_code[0];
  const windMax = Math.round(d.wind_speed_10m_max[0]);
  panel.hidden = false;
  panel.innerHTML = `<h2 class="panel-title">Daily brief</h2>
    <div class="brief-line"><span class="brief-key">TODAY</span><span>${wmo(today)[1]} ${wmo(today)[0]} — high ${T(d.temperature_2m_max[0])}, low ${T(d.temperature_2m_min[0])}.</span></div>
    <div class="brief-line"><span class="brief-key">RAIN</span><span>${rainWin ? "Likely from " + fmtTime(rainWin) + " — max chance " + (d.precipitation_probability_max[0] ?? "—") + "%, " + d.precipitation_sum[0] + " mm expected." : "No meaningful rain in the next 24 hours."}</span></div>
    <div class="brief-line"><span class="brief-key">WIND</span><span>Peaks near ${windMax} ${windU() === "mph" ? "mph" : "km/h"} today.</span></div>
    <div class="brief-line"><span class="brief-key">SUN</span><span>Sunrise ${fmtTime(d.sunrise[0])} · sunset ${fmtTime(d.sunset[0])}.</span></div>`;
}

/* ---------- render: hourly SVG chart (sorted time; tooltips; skips nothing) ---------- */
function renderHourly() {
  const h = state.hourly, wrap = $("#hourly-chart");
  const n = h.time.length;
  const temps = h.temperature_2m, probs = h.precipitation_probability || [];
  const min = Math.min(...temps), max = Math.max(...temps);
  const W = Math.max(n * 46, 400), H = 170;
  const pad = { t: 26, b: 34 }, iw = H - pad.t - pad.b;
  const x = (i) => i * 46 + 24;
  const y = (t) => pad.t + iw * (1 - (t - min) / ((max - min) || 1));
  let svg = `<svg class="hourly-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
  // precip prob bars
  for (let i = 0; i < n; i++) {
    const p = probs[i] ?? 0;
    if (p > 0) {
      const bh = Math.max(2, p / 100 * 22);
      svg += `<rect x="${x(i) - 9}" y="${H - pad.b - bh}" width="18" height="${bh}" fill="#6fa8dc" opacity="0.35" rx="1"></rect>`;
    }
  }
  // temp line + points
  const pts = temps.map((t, i) => `${x(i)},${y(t)}`).join(" ");
  svg += `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2"></polyline>`;
  for (let i = 0; i < n; i++) {
    svg += `<circle cx="${x(i)}" cy="${y(temps[i])}" r="3" fill="var(--accent)" data-i="${i}" class="hpt"></circle>`;
    const hr = new Date(h.time[i]).getHours();
    if (hr % 3 === 0 || i === 0)
      svg += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" class="hbar-time">${hr % 12 === 0 ? 12 : hr % 12}${hr < 12 ? "a" : "p"}</text>`;
    if (i === 0 || i === n - 1 || i % 6 === 0)
      svg += `<text x="${x(i)}" y="${y(temps[i]) - 8}" text-anchor="middle" class="htemp-label">${T(temps[i])}</text>`;
  }
  svg += `</svg>`;
  wrap.innerHTML = `<div class="hourly-chart">${svg}</div>`;
  wrap.querySelectorAll(".hpt").forEach(c => {
    c.addEventListener("mousemove", (e) => {
      const i = +c.dataset.i;
      showTip(e.clientX, e.clientY - 8,
        `${fmtTime(h.time[i])} · ${T(temps[i])} ${wmo(h.weather_code[i])[1]}` +
        (probs[i] != null ? ` · ${probs[i]}% rain` : ""));
    });
    c.addEventListener("mouseleave", hideTip);
  });
}

/* ---------- render: daily list, click → inline detail ---------- */
function renderDaily() {
  const d = state.daily, list = $("#daily-list");
  const lo = Math.min(...d.temperature_2m_min), hi = Math.max(...d.temperature_2m_max);
  list.innerHTML = d.time.map((day, i) => {
    const [desc, ico] = wmo(d.weather_code[i]);
    const l = d.temperature_2m_min[i], g = d.temperature_2m_max[i];
    const left = (l - lo) / ((hi - lo) || 1) * 100, w = (g - l) / ((hi - lo) || 1) * 100;
    const rain = (d.precipitation_probability_max[i] ?? 0) >= 30 || d.precipitation_sum[i] > 0.5;
    return `<div class="day-row" data-day="${i}">
      <div class="day-name">${dayName(day)}<span class="day-date">${dayShort(day)}</span></div>
      <div class="day-ico" title="${desc}">${ico}</div>
      <div class="day-bar"><div class="fill" style="left:${left}%;width:${Math.max(w, 4)}%"></div></div>
      <div class="day-temps"><b>${T(g)}</b> <span class="lo">${T(l)}</span></div>
      <div class="day-rain ${rain ? "wet" : ""}">${rain ? d.precipitation_sum[i] + " mm" : "—"}</div>
    </div>`;
  }).join("");
  list.querySelectorAll(".day-row").forEach(row => row.addEventListener("click", () => {
    const i = +row.dataset.day;
    const detail = list.querySelector(".day-detail");
    if (detail) detail.remove();
    const div = document.createElement("div");
    div.className = "day-detail";
    div.textContent = `${wmo(d.weather_code[i])[0]} · sunrise ${fmtTime(d.sunrise[i])}, sunset ${fmtTime(d.sunset[i])} · max wind ${Math.round(d.wind_speed_10m_max[i])} ${windU() === "mph" ? "mph" : "km/h"} · ${d.precipitation_sum[i]} mm total, ${d.precipitation_probability_max[i] ?? "—"}% peak rain chance.`;
    row.after(div);
  }));
}

/* ---------- radar (RainViewer) ---------- */
async function initRadar() {
  const p = state.active, status = $("#radar-status");
  try {
    const j = await getJSON("https://api.rainviewer.com/public/weather-maps.json");
    const frames = (j.radar?.past || []).concat(j.radar?.nowcast || []);
    if (!frames.length) throw new Error("no frames");
    state.radar.frames = frames; state.radar.host = j.host;
    if (!window.__map) {
      window.__map = L.map("radar-map", { zoomControl: true, scrollWheelZoom: false }).setView([p.lat, p.lon], 7);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors", className: "basemap-dark", maxZoom: 12,
      }).addTo(window.__map);
      window.__radarLayer = L.layerGroup().addTo(window.__map);
    } else { window.__map.setView([p.lat, p.lon], 7); }
    setRadarFrame(frames.length - (j.radar?.nowcast?.length || 0) - 1 >= 0 ? frames.length - 1 - (j.radar?.nowcast?.length || 0) : frames.length - 1);
    $("#radar-play").disabled = false;
    status.className = "panel-status";
    status.textContent = `Radar: RainViewer — ${frames.length} frames, latest frame ${fmtTime(unixToISO(frames[frames.length - 1].time))} UTC`;
  } catch (e) {
    status.className = "panel-status err";
    status.textContent = "Radar unavailable (" + e.message + "). Forecast panels above are unaffected.";
  }
}
function setRadarFrame(i) {
  const f = state.radar.frames[i]; if (!f) return;
  state.radar.idx = i;
  window.__radarLayer.clearLayers();
  L.tileLayer(state.radar.host + f.path + "/256/{z}/{x}/{y}/2/1_1.png", {
    opacity: 0.78, maxZoom: 12,
  }).addTo(window.__radarLayer);
  $("#radar-time").textContent = "Frame " + fmtTime(unixToISO(f.time)) + " UTC";
}
function toggleRadarPlay() {
  const r = state.radar;
  if (r.playing) { clearInterval(r.timer); r.playing = false; $("#radar-play").textContent = "▶ Play"; $("#radar-play").classList.remove("active"); return; }
  r.playing = true; $("#radar-play").textContent = "⏸ Pause"; $("#radar-play").classList.add("active");
  r.timer = setInterval(() => setRadarFrame((r.idx + 1) % r.frames.length), 600);
}

/* ---------- search (Nominatim, throttled + aborted) ---------- */
let searchTimer = null, searchXhr = null, lastQuery = "";
function doSearch(q) {
  clearTimeout(searchTimer);
  if (q === lastQuery) return; lastQuery = q;
  if (q.trim().length < 2) { $("#search-results").hidden = true; return; }
  searchTimer = setTimeout(async () => {
    if (searchXhr) searchXhr.abort();
    searchXhr = new AbortController();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&limit=6`, { signal: searchXhr.signal });
      const rows = await r.json();
      const box = $("#search-results");
      if (!rows.length) { box.innerHTML = `<button disabled>No matches for “${esc(q)}”</button>`; box.hidden = false; return; }
      box.innerHTML = rows.map((x, i) =>
        `<button data-i="${i}">${esc(x.name || x.display_name.split(",")[0])}<div class="sr-sub">${esc(x.display_name.split(",").slice(1, 4).join(",").trim())}</div></button>`).join("");
      box.hidden = false;
      box.querySelectorAll("button[data-i]").forEach(b => b.addEventListener("click", () => {
        const x = rows[+b.dataset.i];
        const nm = x.name || x.display_name.split(",")[0];
        addPlace({ name: nm + ", " + (x.display_name.split(",").slice(-1)[0] || "").trim(), lat: +x.lat, lon: +x.lon });
        box.hidden = true; $("#search").value = "";
      }));
    } catch {}
  }, 500);
}

/* ---------- saved places ---------- */
function addPlace(p) {
  const dup = state.places.find(x => Math.abs(x.lat - p.lat) < .05 && Math.abs(x.lon - p.lon) < .05);
  if (!dup) { state.places.unshift(p); LS.set("places", state.places.slice(0, 12)); }
  selectPlace(dup || p);
}
function selectPlace(p) {
  state.active = p; LS.set("active", p);
  history.replaceState(null, "", "#/" + encodeURIComponent(p.name));
  renderLocBar(); loadForecast(); initRadar();
}
function renderLocBar() {
  const bar = $("#loc-bar");
  const all = [{ name: state.active.name, ...state.active }, ...state.places.filter(p => p.name !== state.active.name)];
  bar.innerHTML = all.map((p, i) => {
    const act = p.name === state.active.name;
    const removable = !act && state.places.some(q => q.name === p.name);
    return `<button class="loc-chip ${act ? "active" : ""}" data-name="${esc(p.name)}">${esc(p.name)}${removable ? '<span class="chip-x">✕</span>' : ""}</button>`;
  }).join("") + `<span class="add-hint">Saved locations live in this browser only.</span>`;
  bar.querySelectorAll(".loc-chip").forEach(chip => {
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("chip-x")) {
        state.places = state.places.filter(p => p.name !== chip.dataset.name);
        LS.set("places", state.places); renderLocBar(); e.stopPropagation(); return;
      }
      const p = all.find(x => x.name === chip.dataset.name);
      if (p) selectPlace(p);
    });
  });
}

/* ---------- helpers ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function dayName(iso) {
  return new Date(iso + "T12:00").toLocaleDateString([], { weekday: "short" });
}
function dayShort(iso) {
  return new Date(iso + "T12:00").toLocaleDateString([], { month: "short", day: "numeric" });
}
function unixToISO(u) { return new Date(u * 1000).toISOString(); }
function compass(deg) {
  const dirs = ["N","NE","E","SE","S","SW","W","NW"];
  return dirs[Math.round(deg / 45) % 8];
}
function showTip(x, y, txt) { const t = $("#tooltip"); t.textContent = txt; t.style.left = x + "px"; t.style.top = y + "px"; t.hidden = false; }
function hideTip() { $("#tooltip").hidden = true; }

/* ---------- wire up ---------- */
$("#search").addEventListener("input", (e) => doSearch(e.target.value));
document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) $("#search-results").hidden = true; });
$("#unit-btn").addEventListener("click", () => {
  state.units = state.units === "imperial" ? "metric" : "imperial";
  LS.set("units", state.units);
  $("#unit-btn").textContent = state.units === "imperial" ? "°F" : "°C";
  loadForecast();
});
$("#theme-btn").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  LS.set("theme", state.theme);
  document.documentElement.dataset.theme = state.theme;
});
$("#geo-btn").addEventListener("click", () => {
  if (!navigator.geolocation) return;
  $("#geo-btn").textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(async (pos) => {
    $("#geo-btn").textContent = "◎ My location";
    let nm = "My location";
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}&format=jsonv2&zoom=8`, { headers: { Accept: "application/json" } });
      const j = await r.json();
      if (j.address) nm = (j.address.city || j.address.town || j.address.village || j.address.county || "My location") + ", " + (j.address.state || j.address.country || "");
    } catch {}
    addPlace({ name: nm, lat: +pos.coords.latitude.toFixed(4), lon: +pos.coords.longitude.toFixed(4) });
  }, () => { $("#geo-btn").textContent = "◎ My location"; }, { timeout: 8000 });
});
$("#radar-play").addEventListener("click", toggleRadarPlay);

/* boot */
document.documentElement.dataset.theme = state.theme;
$("#unit-btn").textContent = state.units === "imperial" ? "°F" : "°C";
renderLocBar();
loadForecast();
initRadar();
