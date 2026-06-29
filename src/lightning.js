/**
 * Pure, DOM-free helpers for the Blitzortung lightning overlay.
 * No Leaflet / window / document references, so this module is unit-testable
 * under Node's built-in test runner.
 */

export const BLITZORTUNG_SOURCE = 'blitzortung';
const GEO_LOCATION_PREFIX = 'geo_location.';
const DEFAULT_STRIKE_CAP = 750;

// Recency colour ramp: white-hot (newest) -> dark red (oldest).
export const LIGHTNING_COLOR_STOPS = [
  { t: 0.0, color: '#ffffff' },
  { t: 0.2, color: '#ffeb3b' },
  { t: 0.4, color: '#ff9800' },
  { t: 0.6, color: '#ff6347' },
  { t: 0.8, color: '#ff0000' },
  { t: 1.0, color: '#8b0000' },
];

export function isBlitzortungLoaded(hass) {
  const components = hass?.config?.components;
  return Array.isArray(components) && components.includes(BLITZORTUNG_SOURCE);
}

export function parseStrikeTimestamp(state) {
  const pub = state?.attributes?.publication_date;
  if (typeof pub === 'string') {
    const parsed = Date.parse(pub);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof pub === 'number' && Number.isFinite(pub)) {
    return pub < 1e12 ? pub * 1000 : pub;
  }
  const lastChanged = Date.parse(state?.last_changed);
  if (Number.isFinite(lastChanged)) return lastChanged;
  return Date.now();
}

export function collectLightningStrikes(hass, cap = DEFAULT_STRIKE_CAP) {
  const states = hass?.states;
  if (!states) return [];
  const strikes = [];
  for (const id in states) {
    if (!id.startsWith(GEO_LOCATION_PREFIX)) continue;
    const state = states[id];
    const attrs = state?.attributes;
    if (!attrs || attrs.source !== BLITZORTUNG_SOURCE) continue;
    const lat = Number(attrs.latitude);
    const lon = Number(attrs.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    strikes.push({ id, lat, lon, ts: parseStrikeTimestamp(state) });
  }
  strikes.sort((a, b) => b.ts - a.ts);
  return strikes.length > cap ? strikes.slice(0, cap) : strikes;
}

function clamp01(value) {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function lerpHex(a, b, t) {
  const ah = a.replace('#', '');
  const bh = b.replace('#', '');
  const k = clamp01(t);
  const channel = (start, end) => Math.round(start + (end - start) * k);
  const r = channel(parseInt(ah.slice(0, 2), 16), parseInt(bh.slice(0, 2), 16));
  const g = channel(parseInt(ah.slice(2, 4), 16), parseInt(bh.slice(2, 4), 16));
  const b2 = channel(parseInt(ah.slice(4, 6), 16), parseInt(bh.slice(4, 6), 16));
  const hex = (n) => n.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b2)}`;
}

export function colorForAge(ageSec, maxAgeSec) {
  const max = maxAgeSec > 0 ? maxAgeSec : 1;
  const t = clamp01(ageSec / max);
  const stops = LIGHTNING_COLOR_STOPS;
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const prev = stops[i - 1];
      const next = stops[i];
      const span = next.t - prev.t || 1;
      return lerpHex(prev.color, next.color, (t - prev.t) / span);
    }
  }
  return stops[stops.length - 1].color;
}

// Fade strikes from full opacity (newest) to 0.35 (at the fade window).
export function opacityForAge(ageSec, fadeSec) {
  const max = fadeSec > 0 ? fadeSec : 1;
  return 1 - 0.65 * clamp01(ageSec / max);
}

// One-shot appear pulse: radius scale 2x -> 1x, ease-out, over a normalised t in [0,1].
export function pulseScale(t) {
  if (t >= 1) return 1;
  const k = t < 0 ? 0 : t;
  return 1 + (1 - k) * (1 - k);
}
