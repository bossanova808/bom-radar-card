import assert from 'node:assert/strict';
import test from 'node:test';

import { loadImageWithRetry } from '../src/image-retry.js';

function createImage() {
  const assignedSources = [];
  let currentSource = null;
  return {
    assignedSources,
    onerror: null,
    onload: null,
    getAttribute(name) {
      return name === 'src' ? currentSource : null;
    },
    set src(value) {
      currentSource = value;
      assignedSources.push(value);
    },
  };
}

test('retries a failed image load once before completing', () => {
  const image = createImage();
  const scheduled = [];
  let completions = 0;

  loadImageWithRetry(image, 'https://example.test/tile.png', 'data:image/png;base64,fallback', () => {
    completions++;
  }, {
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
  });

  image.onerror();
  assert.equal(completions, 0);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 1000);

  scheduled[0].callback();
  assert.deepEqual(image.assignedSources, [
    'https://example.test/tile.png',
    'https://example.test/tile.png',
  ]);

  image.onload();
  image.onload();
  assert.equal(completions, 1);
});

test('uses the transparent fallback after the retry fails', () => {
  const image = createImage();
  const scheduled = [];
  let completions = 0;

  loadImageWithRetry(image, 'https://example.test/tile.png', 'data:image/png;base64,fallback', () => {
    completions++;
  }, {
    schedule: (callback) => scheduled.push(callback),
  });

  image.onerror();
  scheduled[0]();
  image.onerror();

  assert.deepEqual(image.assignedSources, [
    'https://example.test/tile.png',
    'https://example.test/tile.png',
    'data:image/png;base64,fallback',
  ]);
  assert.equal(image.onerror, null);
  assert.equal(completions, 1);
});

test('does not retry after Leaflet replaces handlers for an aborted tile', () => {
  const image = createImage();
  const scheduled = [];

  loadImageWithRetry(image, 'https://example.test/tile.png', 'data:image/png;base64,fallback', () => {}, {
    schedule: (callback) => scheduled.push(callback),
  });

  image.onerror();
  image.onerror = () => {};
  image.onload = () => {};
  scheduled[0]();

  assert.deepEqual(image.assignedSources, ['https://example.test/tile.png']);
});

test('does not retry after Leaflet removes a tile without replacing its handlers', () => {
  const image = createImage();
  const scheduled = [];

  loadImageWithRetry(image, 'https://example.test/tile.png', 'data:image/png;base64,fallback', () => {}, {
    schedule: (callback) => scheduled.push(callback),
  });

  image.onerror();
  image.src = 'data:image/gif;base64,leaflet-empty-image';
  scheduled[0]();

  assert.deepEqual(image.assignedSources, [
    'https://example.test/tile.png',
    'data:image/gif;base64,leaflet-empty-image',
  ]);
});
