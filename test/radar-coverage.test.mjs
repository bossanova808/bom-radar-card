import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RADAR_COVERAGE_TILE_OPTIONS,
  RADAR_COVERAGE_TILE_URL,
  shouldShowRadarCoverage,
  supportsRadarCoverageLayer,
} from '../src/radar-coverage.js';

test('radar coverage is opt-in and limited to the two supported radar layers', () => {
  assert.equal(shouldShowRadarCoverage({ show_radar_coverage: false, layer: 'reflectivity' }), false);
  assert.equal(shouldShowRadarCoverage({ show_radar_coverage: true, layer: 'reflectivity' }), true);
  assert.equal(shouldShowRadarCoverage({ show_radar_coverage: true, layer: 'rain_rate' }), true);
  assert.equal(shouldShowRadarCoverage({ show_radar_coverage: true, layer: 'accumulation_1hr' }), false);
  assert.equal(supportsRadarCoverageLayer('reflectivity'), true);
  assert.equal(supportsRadarCoverageLayer('rain_rate'), true);
  assert.equal(supportsRadarCoverageLayer('air_temperature'), false);
});

test('radar coverage uses the official cached MapServer tiles at their native zoom', () => {
  assert.equal(
    RADAR_COVERAGE_TILE_URL,
    'https://api.bom.gov.au/apikey/v1/mapping/overlays/radar_coverage/MapServer/tile/{z}/{y}/{x}?blankTile=false',
  );
  assert.deepEqual(RADAR_COVERAGE_TILE_OPTIONS, {
    maxNativeZoom: 10,
    opacity: 1,
  });
});
