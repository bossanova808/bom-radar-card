import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createImageAvailabilityProbe,
  createTimestampAvailabilityResolver,
} from '../src/timestamp-availability.js';

function timestamps(start, count, stepMinutes) {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) =>
    new Date(startMs + index * stepMinutes * 60_000).toISOString().replace('.000Z', 'Z'));
}

function request(cacheKey, frames, stepMinutes) {
  return { cacheKey, timestamps: frames, stepMinutes };
}

for (const count of [9, 7, 4]) {
  test(`preserves a valid ${count}-frame schedule using two probes`, async () => {
    const frames = timestamps('2026-08-13T00:00:00Z', count, 60);
    const calls = [];
    const resolver = createTimestampAvailabilityResolver({
      probe: async (timestamp) => {
        calls.push(timestamp);
        return true;
      },
    });

    assert.deepEqual(await resolver.resolve(request(`valid-${count}`, frames, 60)), frames);
    assert.deepEqual(calls, [frames[0], frames.at(-1)]);
  });
}

test('shifts a forecast window back one cadence within a four-probe budget', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 7, 1440);
  const replacement = '2026-08-12T00:00:00Z';
  const calls = [];
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls.push(timestamp);
      return timestamp !== frames.at(-1);
    },
  });

  assert.deepEqual(
    await resolver.resolve(request('forecast', frames, 1440)),
    [replacement, ...frames.slice(0, -1)],
  );
  assert.deepEqual(calls, [frames[0], frames.at(-1), frames.at(-1), replacement]);
});

test('shifts an observed window forward one cadence within a four-probe budget', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 9, 5);
  const replacement = '2026-08-13T00:45:00Z';
  const calls = [];
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls.push(timestamp);
      return timestamp !== frames[0];
    },
  });

  assert.deepEqual(
    await resolver.resolve(request('past', frames, 5)),
    [...frames.slice(1), replacement],
  );
  assert.deepEqual(calls, [frames[0], frames.at(-1), frames[0], replacement]);
});

test('keeps the nominal schedule when a failed boundary succeeds on retry', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 4, 60);
  const attempts = new Map();
  const calls = [];
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls.push(timestamp);
      const attempt = (attempts.get(timestamp) ?? 0) + 1;
      attempts.set(timestamp, attempt);
      return timestamp !== frames.at(-1) || attempt === 2;
    },
  });

  assert.deepEqual(await resolver.resolve(request('transient', frames, 60)), frames);
  assert.deepEqual(calls, [frames[0], frames.at(-1), frames.at(-1)]);
});

test('treats two failed boundaries as an outage without retrying', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 9, 5);
  let calls = 0;
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => {
      calls++;
      return false;
    },
  });

  assert.deepEqual(await resolver.resolve(request('outage', frames, 5)), frames);
  assert.equal(calls, 2);
});

test('absorbs thrown probe failures and preserves the schedule', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 7, 1440);
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => { throw new Error('network failure'); },
  });

  assert.deepEqual(await resolver.resolve(request('throw', frames, 1440)), frames);
});

test('shifts a forecast window forward when its first boundary is stale', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 4, 60);
  const replacement = '2026-08-13T04:00:00Z';
  const calls = [];
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls.push(timestamp);
      return timestamp !== frames[0];
    },
  });

  assert.deepEqual(
    await resolver.resolve(request('forecast-forward', frames, 60)),
    [...frames.slice(1), replacement],
  );
  assert.deepEqual(calls, [frames[0], frames.at(-1), frames[0], replacement]);
});

test('shifts an observed window back when its last boundary is not published yet', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 4, 5);
  const replacement = '2026-08-12T23:55:00Z';
  const calls = [];
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls.push(timestamp);
      return timestamp !== frames.at(-1);
    },
  });

  assert.deepEqual(
    await resolver.resolve(request('past-backward', frames, 5)),
    [replacement, ...frames.slice(0, -1)],
  );
  assert.deepEqual(calls, [frames[0], frames.at(-1), frames.at(-1), replacement]);
});

test('preserves the schedule when its padded replacement is unavailable', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 7, 1440);
  const replacement = '2026-08-12T00:00:00Z';
  let calls = 0;
  const resolver = createTimestampAvailabilityResolver({
    probe: async (timestamp) => {
      calls++;
      return timestamp !== frames.at(-1) && timestamp !== replacement;
    },
  });

  assert.deepEqual(await resolver.resolve(request('replacement', frames, 1440)), frames);
  assert.equal(calls, 4);
});

test('does not delay a one-frame schedule that cannot be shifted', async () => {
  const frames = ['2026-08-13T00:00:00Z'];
  let calls = 0;
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => {
      calls++;
      return false;
    },
  });

  assert.deepEqual(await resolver.resolve(request('single', frames, 60)), frames);
  assert.equal(calls, 0);
});

test('coalesces in-flight probes and expires positive and negative cache entries separately', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 4, 60);
  let clock = 0;
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => {
      calls++;
      await gate;
      return true;
    },
    positiveCacheTtlMs: 90_000,
    negativeCacheTtlMs: 10_000,
    now: () => clock,
  });
  const sharedRequest = request('positive', frames, 60);

  const first = resolver.resolve(sharedRequest);
  const second = resolver.resolve(sharedRequest);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  await resolver.resolve(sharedRequest);
  assert.equal(calls, 2);
  clock = 90_000;
  await resolver.resolve(sharedRequest);
  assert.equal(calls, 4);

  const negativeFrames = timestamps('2026-08-13T10:00:00Z', 2, 60);
  const negativeResolver = createTimestampAvailabilityResolver({
    probe: async () => {
      calls++;
      return false;
    },
    negativeCacheTtlMs: 10_000,
    now: () => clock,
  });
  await negativeResolver.resolve(request('negative', negativeFrames, 60));
  await negativeResolver.resolve(request('negative', negativeFrames, 60));
  assert.equal(calls, 6);
  clock += 10_000;
  await negativeResolver.resolve(request('negative', negativeFrames, 60));
  assert.equal(calls, 8);
});

test('evicts the least-recently-used settled probe when the cache is bounded', async () => {
  let calls = 0;
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => {
      calls++;
      return true;
    },
    maxCacheEntries: 2,
  });
  const frames = timestamps('2026-08-13T00:00:00Z', 2, 60);

  await resolver.resolve(request('a', frames, 60));
  await resolver.resolve(request('b', frames, 60));
  await resolver.resolve(request('a', frames, 60));
  assert.equal(calls, 6);
});

test('discards a completed correction when its request generation is stale', async () => {
  const frames = timestamps('2026-08-13T00:00:00Z', 4, 60);
  let current = true;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const resolver = createTimestampAvailabilityResolver({
    probe: async () => {
      await gate;
      return true;
    },
  });
  const pending = resolver.resolve({
    ...request('stale', frames, 60),
    isCurrent: () => current,
  });
  current = false;
  release();

  assert.deepEqual(await pending, frames);
});

test('requires non-zero image dimensions and handles errors and timeouts', async () => {
  const images = [];
  const timers = [];
  const probe = createImageAvailabilityProbe({
    buildUrl: (timestamp) => `https://example.test/${timestamp}.png`,
    createImage: () => {
      const image = { naturalWidth: 0, naturalHeight: 0, onload: null, onerror: null, src: null };
      images.push(image);
      return image;
    },
    schedule: (callback) => {
      timers.push(callback);
      return timers.length;
    },
    cancelSchedule: () => {},
  });

  const empty = probe('empty');
  images[0].onload();
  assert.equal(await empty, false);

  const valid = probe('valid');
  images[1].naturalWidth = 256;
  images[1].naturalHeight = 256;
  images[1].onload();
  assert.equal(await valid, true);

  const failed = probe('failed');
  images[2].onerror();
  assert.equal(await failed, false);

  const timedOut = probe('timeout');
  timers[3]();
  assert.equal(await timedOut, false);
  assert.match(images[3].src, /^data:image\/gif;/, 'timeout cancels the underlying image request locally');
});
