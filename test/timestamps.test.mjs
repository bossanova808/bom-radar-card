import assert from 'node:assert/strict';
import test from 'node:test';

import { BOM_LAYERS } from '../src/bom-layers.js';
import { generateFallbackTimestamps, getRoundedUtcDate } from '../src/timestamps.js';

const EARLY_AUDIT_TIME = new Date('2026-08-11T02:35:00Z');
const ROLLOVER_AUDIT_TIME = new Date('2026-08-11T11:45:00Z');

function timestampRange(start, count, stepMinutes) {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * stepMinutes * 60_000).toISOString().replace('.000Z', 'Z'));
}

test('preserves the public v1.10.1 frame-count contract', () => {
  const publicMaximums = {
    accumulation_24hr: 7,
    forecast_rain_50pct_daily: 7,
    forecast_rain_25pct_daily: 7,
    forecast_rain_10pct_daily: 7,
    forecast_rain_chance_daily: 7,
    temperature_max_daily: 7,
    temperature_min_daily: 7,
    heatwave_severity: 7,
    uv_max_daily: 4,
  };

  for (const [layerKey, config] of Object.entries(BOM_LAYERS)) {
    const expectedCount = publicMaximums[layerKey] ?? 9;
    assert.equal(
      generateFallbackTimestamps(config, 9, EARLY_AUDIT_TIME).length,
      expectedCount,
      `${layerKey} changed the number of frames exposed by v1.10.1`,
    );
  }
});

test('rounds observed timestamps down to the configured cadence', () => {
  assert.equal(
    getRoundedUtcDate(EARLY_AUDIT_TIME, 180).toISOString(),
    '2026-08-11T00:00:00.000Z',
  );
});

test('starts three-hour forecasts at the next current or future cadence', () => {
  const threeHourlyForecasts = Object.entries(BOM_LAYERS).filter(([, config]) =>
    config.timeMode === 'forecast' && config.fallbackStepMinutes === 180);

  assert.ok(threeHourlyForecasts.length > 0);
  for (const [layerKey, config] of threeHourlyForecasts) {
    const earlyFrames = generateFallbackTimestamps(config, 9, EARLY_AUDIT_TIME);
    const rolloverFrames = generateFallbackTimestamps(config, 9, ROLLOVER_AUDIT_TIME);

    assert.equal(earlyFrames[0], '2026-08-11T03:00:00Z', `${layerKey} retained an expired early cadence`);
    assert.equal(rolloverFrames[0], '2026-08-11T12:00:00Z', `${layerKey} retained an expired rollover cadence`);
  }
});

test('an exact forecast cadence boundary is retained instead of skipped', () => {
  const frames = generateFallbackTimestamps(
    BOM_LAYERS.air_temperature,
    1,
    new Date('2026-08-11T12:00:00Z'),
  );
  assert.deepEqual(frames, ['2026-08-11T12:00:00Z']);
});

test('preserves v1.10.1 five-minute observation schedules', () => {
  assert.deepEqual(
    generateFallbackTimestamps(BOM_LAYERS.reflectivity, 9, EARLY_AUDIT_TIME),
    [
      '2026-08-11T01:45:00Z',
      '2026-08-11T01:50:00Z',
      '2026-08-11T01:55:00Z',
      '2026-08-11T02:00:00Z',
      '2026-08-11T02:05:00Z',
      '2026-08-11T02:10:00Z',
      '2026-08-11T02:15:00Z',
      '2026-08-11T02:20:00Z',
      '2026-08-11T02:25:00Z',
    ],
  );
  for (const layerKey of ['rain_rate', 'accumulation_1hr']) {
    assert.deepEqual(
      generateFallbackTimestamps(BOM_LAYERS[layerKey], 9, EARLY_AUDIT_TIME),
      timestampRange('2026-08-11T01:50:00Z', 9, 5),
      `${layerKey} changed its public observation window`,
    );
  }
});

test('preserves v1.10.1 daily forecast anchors and limits', () => {
  assert.deepEqual(generateFallbackTimestamps(BOM_LAYERS.forecast_rain_chance_daily, 9, EARLY_AUDIT_TIME), [
    '2026-08-11T15:00:00Z',
    '2026-08-12T15:00:00Z',
    '2026-08-13T15:00:00Z',
    '2026-08-14T15:00:00Z',
    '2026-08-15T15:00:00Z',
    '2026-08-16T15:00:00Z',
    '2026-08-17T15:00:00Z',
  ]);
  assert.deepEqual(generateFallbackTimestamps(BOM_LAYERS.heatwave_severity, 9, EARLY_AUDIT_TIME), [
    '2026-08-11T00:00:00Z',
    '2026-08-12T00:00:00Z',
    '2026-08-13T00:00:00Z',
    '2026-08-14T00:00:00Z',
    '2026-08-15T00:00:00Z',
    '2026-08-16T00:00:00Z',
    '2026-08-17T00:00:00Z',
  ]);
  assert.deepEqual(generateFallbackTimestamps(BOM_LAYERS.uv_max_daily, 9, EARLY_AUDIT_TIME), [
    '2026-08-12T00:00:00Z',
    '2026-08-13T00:00:00Z',
    '2026-08-14T00:00:00Z',
    '2026-08-15T00:00:00Z',
  ]);
});
