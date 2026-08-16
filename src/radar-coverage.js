export const RADAR_COVERAGE_TILE_URL =
  'https://api.bom.gov.au/apikey/v1/mapping/overlays/radar_coverage/MapServer/tile/{z}/{y}/{x}?blankTile=false';

export const RADAR_COVERAGE_TILE_OPTIONS = Object.freeze({
  maxNativeZoom: 10,
  opacity: 1,
});

const RADAR_COVERAGE_LAYERS = new Set(['rain_rate', 'reflectivity']);

export function supportsRadarCoverageLayer(layerKey) {
  return RADAR_COVERAGE_LAYERS.has(layerKey);
}

export function shouldShowRadarCoverage(config) {
  return config?.show_radar_coverage === true && supportsRadarCoverageLayer(config?.layer);
}
