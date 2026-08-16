import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getFixedHeightGridOptions } from '../src/grid-options.js';

test('locks Sections rows to the fixed default map height', () => {
  assert.deepEqual(getFixedHeightGridOptions(300), {
    rows: 5,
    min_rows: 5,
    max_rows: 5,
    columns: 12,
    min_columns: 6,
    max_columns: 12,
  });
});

test('preserves Home Assistant minimum rows and rounds larger fixed heights up', () => {
  assert.equal(getFixedHeightGridOptions(1).rows, 4);
  assert.equal(getFixedHeightGridOptions(600).rows, 10);
  assert.equal(getFixedHeightGridOptions(4096).rows, 65);
});
