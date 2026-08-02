import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createResizeGuardedMap, invalidateMapSizeIfVisible } from '../src/map-resize.js';

function createMapSpy() {
  return {
    invalidateSizeCalls: 0,
    invalidateSize() {
      this.invalidateSizeCalls += 1;
    },
  };
}

function createContainer(width, height, isConnected = true, clientWidth = width, clientHeight = height) {
  return {
    isConnected,
    clientWidth,
    clientHeight,
    getBoundingClientRect() {
      return { width, height };
    },
  };
}

test('disables Leaflet native window resize invalidation', () => {
  const container = createContainer(750, 500);
  const expectedMap = {};
  let receivedOptions;
  const leaflet = {
    map(receivedContainer, options) {
      assert.equal(receivedContainer, container);
      receivedOptions = options;
      return expectedMap;
    },
  };

  assert.equal(createResizeGuardedMap(leaflet, container, { zoom: 9, trackResize: true }), expectedMap);
  assert.deepEqual(receivedOptions, { zoom: 9, trackResize: false });
});

test('does not invalidate Leaflet while its container is hidden', () => {
  const map = createMapSpy();

  assert.equal(invalidateMapSizeIfVisible(map, createContainer(0, 500)), false);
  assert.equal(invalidateMapSizeIfVisible(map, createContainer(750, 0)), false);
  assert.equal(map.invalidateSizeCalls, 0);
});

test('does not invalidate a detached Leaflet container', () => {
  const map = createMapSpy();

  assert.equal(invalidateMapSizeIfVisible(map, createContainer(750, 500, false)), false);
  assert.equal(map.invalidateSizeCalls, 0);
});

test('does not invalidate when Leaflet rounds a fractional layout size to zero', () => {
  const map = createMapSpy();
  const container = createContainer(0.4, 500, true, 0, 500);

  assert.equal(invalidateMapSizeIfVisible(map, container), false);
  assert.equal(map.invalidateSizeCalls, 0);
});

test('invalidates Leaflet once the container has a rendered size', () => {
  const map = createMapSpy();

  assert.equal(invalidateMapSizeIfVisible(map, createContainer(750, 500)), true);
  assert.equal(map.invalidateSizeCalls, 1);
});
