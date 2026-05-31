# Changelog

## v1.7.0 - 2026-05-31

### Added

- Added optional `basemap_style: auto` mode, which uses Home Assistant's `sun.sun` state to switch between the provider's light daytime basemap and dark nighttime basemap.
- Added visual editor support for the auto day/night basemap style.

### Documentation

- Documented the new auto day/night basemap mode and updated release references for `v1.7.0`.

## v1.6.6 - 2026-05-29

### Fixed

- Fixed excess whitespace under the card in Home Assistant masonry and sections views by making the layout size estimate match the rendered `map_height`.
- Stopped playback controls from adding phantom layout height. Playback is overlaid on the map, so it no longer changes the reserved card height.
- Fixed BOM capabilities loading so the request is only used from CORS-safe contexts. Home Assistant browser dashboards now go straight to generated current timestamps instead of attempting a known-blocked capabilities request before falling back.
- Rebuilt the card when Home Assistant calls `setConfig()` after the map is already initialized, keeping editor/runtime config changes aligned with the rendered map.
- Reset playback state during runtime rebuilds so a paused card cannot come back with stale controls or no visible way to resume.
- Updated the embedded card banner version to match the package release.

### Documentation

- Clarified how `map_height`, `getCardSize()`, and sections-grid rows relate to each other.
- Documented that unknown migrated keys are ignored, and that `overlay_transparency` and `show_scale` are not supported options for this card.
- Updated release references and issue-template version hints for `v1.6.6`.

## v1.6.5 - 2026-05-11

### Fixed

- Fixed Home Assistant sidebar / SPA navigation returning to a dashboard with the card stuck in the loading state.
- Delayed card initialization until the element is connected and both config and Home Assistant state are available.
- Added lifecycle tokens so stale async initialization, Leaflet loading, and radar data loading cannot update a card after it has been disconnected and reconnected.
- Cleaned up partially-created Leaflet maps when initialization fails so a later retry can start from a clean state.
- Re-invalidated Leaflet size after attach and resize so maps recover correctly in Home Assistant sections views and hidden-to-visible dashboard layouts.
- Guarded BOM tile fallback completion so tile error fallback cannot call Leaflet's tile completion callback more than once.

### Verification Notes

- Verified with local Node regression checks for detached config/state setup, connected-first setup, SPA detach/reconnect, stale async initialization, stale radar data loading, partial map cleanup, and BOM tile fallback completion.
- Verified with browser lifecycle and live visual harnesses using real Leaflet, CARTO basemap tiles, and BOM WMTS tile requests.
- CI verifies the production bundle builds and committed `dist/bom-radar-card.js` remains current.

### Verified

- `npm run build`
- `node --check src/bom-radar-card.js`
- `git diff --check`
- `npm audit --omit=dev`
- `npm ci --dry-run`
- Browser preview with real map tiles
- Browser lifecycle harness
- Browser live harness covering overlay switching, timestamp labels, zoom, recenter, detach/reattach, hidden-to-visible, and narrow layout behavior
