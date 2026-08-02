/**
 * Let the card's guarded container observer own all Leaflet size updates.
 * Leaflet's native window listener invalidates unconditionally and can cache
 * 0x0 while a Lovelace view is hidden.
 */
export function createResizeGuardedMap(leaflet, container, options) {
  return leaflet.map(container, { ...options, trackResize: false });
}

/**
 * Invalidate Leaflet only while its container participates in layout.
 * Invalidating at 0x0 lets a hidden Lovelace view overwrite Leaflet's last
 * usable size before the view becomes visible again.
 */
export function invalidateMapSizeIfVisible(map, container) {
  if (!map || typeof map.invalidateSize !== 'function' || !container) return false;
  if (container.isConnected === false) return false;

  // Leaflet's getSize() reads these integer layout dimensions. Checking the
  // same values avoids invalidating at a fractional size that Leaflet rounds
  // down to zero during a collapse or resize animation.
  if (!(container.clientWidth > 0) || !(container.clientHeight > 0)) return false;

  map.invalidateSize();
  return true;
}
