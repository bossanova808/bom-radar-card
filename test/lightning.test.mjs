import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlitzortungLoaded,
  parseStrikeTimestamp,
  collectLightningStrikes,
  lerpHex,
  colorForAge,
  opacityForAge,
  pulseScale,
} from '../src/lightning.js';

test('isBlitzortungLoaded', () => {
  assert.equal(isBlitzortungLoaded({ config: { components: ['foo', 'blitzortung'] } }), true);
  assert.equal(isBlitzortungLoaded({ config: { components: ['foo'] } }), false);
  assert.equal(isBlitzortungLoaded({ config: {} }), false);
  assert.equal(isBlitzortungLoaded({}), false);
  assert.equal(isBlitzortungLoaded(undefined), false);
});

test('parseStrikeTimestamp', () => {
  assert.equal(
    parseStrikeTimestamp({ attributes: { publication_date: '2024-01-01T00:00:00Z' } }),
    Date.parse('2024-01-01T00:00:00Z'),
  );
  assert.equal(parseStrikeTimestamp({ attributes: { publication_date: 1700000000 } }), 1700000000000);
  assert.equal(parseStrikeTimestamp({ attributes: { publication_date: 1700000000000 } }), 1700000000000);
  assert.equal(
    parseStrikeTimestamp({ last_changed: '2024-01-01T00:00:00Z', attributes: {} }),
    Date.parse('2024-01-01T00:00:00Z'),
  );
  assert.ok(Number.isFinite(parseStrikeTimestamp({ attributes: {} })));
});

test('collectLightningStrikes filters by domain + source + finite coords', () => {
  const hass = { states: {
    'geo_location.lightning_strike_a': { attributes: { source: 'blitzortung', latitude: -33.8, longitude: 151.2, publication_date: 2000 } },
    'geo_location.quake_b': { attributes: { source: 'usgs_earthquakes', latitude: -34, longitude: 151 } },
    'sensor.not_geo': { attributes: { source: 'blitzortung', latitude: -33, longitude: 151 } },
    'geo_location.lightning_strike_bad': { attributes: { source: 'blitzortung', latitude: 'x', longitude: 151 } },
  } };
  const out = collectLightningStrikes(hass);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'geo_location.lightning_strike_a');
  assert.deepEqual([out[0].lat, out[0].lon], [-33.8, 151.2]);
});

test('collectLightningStrikes sorts newest first and respects cap', () => {
  const states = {};
  for (let i = 0; i < 5; i++) {
    states[`geo_location.lightning_strike_${i}`] = { attributes: { source: 'blitzortung', latitude: -33, longitude: 151, publication_date: 1000 + i } };
  }
  const out = collectLightningStrikes({ states }, 3);
  assert.equal(out.length, 3);
  assert.deepEqual(out.map((s) => s.ts), [1004000, 1003000, 1002000]);
});

test('collectLightningStrikes handles empty', () => {
  assert.deepEqual(collectLightningStrikes({}), []);
  assert.deepEqual(collectLightningStrikes(undefined), []);
});

test('lerpHex', () => {
  assert.equal(lerpHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(lerpHex('#ff0000', '#0000ff', 0), '#ff0000');
  assert.equal(lerpHex('#ff0000', '#0000ff', 1), '#0000ff');
});

test('colorForAge ramp + clamping', () => {
  assert.equal(colorForAge(0, 1800), '#ffffff');
  assert.equal(colorForAge(-5, 1800), '#ffffff');
  assert.equal(colorForAge(360, 1800), '#ffeb3b'); // t = 0.2 exactly -> stop
  assert.equal(colorForAge(1800, 1800), '#8b0000');
  assert.equal(colorForAge(9999, 1800), '#8b0000');
});

test('opacityForAge', () => {
  assert.equal(opacityForAge(0, 1800), 1);
  assert.ok(Math.abs(opacityForAge(900, 1800) - 0.675) < 1e-9);  // 1 - 0.65*0.5
  assert.ok(Math.abs(opacityForAge(1800, 1800) - 0.35) < 1e-9);
  assert.ok(Math.abs(opacityForAge(3600, 1800) - 0.35) < 1e-9);  // clamped
});

test('pulseScale', () => {
  assert.equal(pulseScale(0), 2);
  assert.equal(pulseScale(1), 1);
  assert.equal(pulseScale(1.5), 1);
  assert.equal(pulseScale(0.5), 1.25); // 1 + 0.25
});
