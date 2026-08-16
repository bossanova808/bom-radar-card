const DEFAULT_POSITIVE_CACHE_TTL_MS = 90 * 1000;
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 10 * 1000;
const DEFAULT_MAX_CACHE_ENTRIES = 256;
const DEFAULT_PROBE_TIMEOUT_MS = 1500;
const CANCELLED_IMAGE_SOURCE = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

function shiftTimestamp(timestamp, offset, stepMinutes) {
  return new Date(Date.parse(timestamp) + offset * stepMinutes * 60_000)
    .toISOString()
    .replace('.000Z', 'Z');
}

function requestIsCurrent(isCurrent) {
  if (!isCurrent) return true;
  try {
    return isCurrent();
  } catch {
    return false;
  }
}

/**
 * Correct a one-cadence BOM publication rollover without downloading every
 * frame. A reusable resolver shares successful, failed, and in-flight probes
 * between card updates.
 */
export function createTimestampAvailabilityResolver({
  probe,
  positiveCacheTtlMs = DEFAULT_POSITIVE_CACHE_TTL_MS,
  negativeCacheTtlMs = DEFAULT_NEGATIVE_CACHE_TTL_MS,
  maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
  now = Date.now,
} = {}) {
  if (typeof probe !== 'function') throw new TypeError('probe must be a function');
  if (!Number.isInteger(maxCacheEntries) || maxCacheEntries < 1) {
    throw new TypeError('maxCacheEntries must be a positive integer');
  }

  const cache = new Map();
  const inFlight = new Map();

  function setCache(key, available) {
    const ttl = available ? positiveCacheTtlMs : negativeCacheTtlMs;
    cache.delete(key);
    cache.set(key, { available, expiresAt: now() + ttl });
    while (cache.size > maxCacheEntries) {
      cache.delete(cache.keys().next().value);
    }
  }

  function readCache(key) {
    const cached = cache.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt <= now()) {
      cache.delete(key);
      return undefined;
    }
    cache.delete(key);
    cache.set(key, cached);
    return cached.available;
  }

  function getAvailability(cacheKey, timestamp, { retry = false } = {}) {
    const key = `${cacheKey}\u0000${timestamp}`;
    if (!retry) {
      const cached = readCache(key);
      if (cached !== undefined) return Promise.resolve(cached);
    }

    const requestKey = `${retry ? 'retry' : 'nominal'}\u0000${key}`;
    if (inFlight.has(requestKey)) return inFlight.get(requestKey);

    const pending = Promise.resolve()
      .then(() => probe(timestamp, { attempt: retry ? 2 : 1 }))
      .then(Boolean, () => false)
      .then((available) => {
        setCache(key, available);
        return available;
      });
    inFlight.set(requestKey, pending);
    const clearInFlight = () => {
      if (inFlight.get(requestKey) === pending) inFlight.delete(requestKey);
    };
    pending.then(clearInFlight, clearInFlight);
    return pending;
  }

  return {
    async resolve({ cacheKey, timestamps, stepMinutes, isCurrent }) {
      if (!Array.isArray(timestamps) || timestamps.length === 0) {
        throw new TypeError('timestamps must be a non-empty array');
      }
      if (!Number.isFinite(stepMinutes) || stepMinutes <= 0) {
        throw new TypeError('stepMinutes must be a positive number');
      }
      if (typeof cacheKey !== 'string' || cacheKey.length === 0) {
        throw new TypeError('cacheKey must be a non-empty string');
      }

      const original = [...timestamps];
      if (!requestIsCurrent(isCurrent)) return original;
      if (original.length === 1) return original;

      const firstTimestamp = original[0];
      const lastTimestamp = original.at(-1);
      let [firstAvailable, lastAvailable] = await Promise.all([
        getAvailability(cacheKey, firstTimestamp),
        getAvailability(cacheKey, lastTimestamp),
      ]);
      if (!requestIsCurrent(isCurrent)) return original;

      if (firstAvailable && lastAvailable) return original;
      if (!firstAvailable && !lastAvailable) return original;

      if (!firstAvailable) {
        firstAvailable = await getAvailability(cacheKey, firstTimestamp, { retry: true });
      } else {
        lastAvailable = await getAvailability(cacheKey, lastTimestamp, { retry: true });
      }
      if (!requestIsCurrent(isCurrent)) return original;
      if (firstAvailable && lastAvailable) return original;

      const shiftBackward = firstAvailable && !lastAvailable;
      const shiftForward = !firstAvailable && lastAvailable;
      if (!shiftBackward && !shiftForward) return original;

      const replacement = shiftBackward
        ? shiftTimestamp(firstTimestamp, -1, stepMinutes)
        : shiftTimestamp(lastTimestamp, 1, stepMinutes);
      const replacementAvailable = await getAvailability(cacheKey, replacement);
      if (!requestIsCurrent(isCurrent) || !replacementAvailable) return original;

      return shiftBackward
        ? [replacement, ...original.slice(0, -1)]
        : [...original.slice(1), replacement];
    },
  };
}

/**
 * Adapt browser Image loading into the boolean probe expected by the resolver.
 * A successful load must contain image pixels; empty HTTP/error responses are
 * not accepted as available tiles.
 */
export function createImageAvailabilityProbe({
  buildUrl,
  createImage = () => new Image(),
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
} = {}) {
  if (typeof buildUrl !== 'function') throw new TypeError('buildUrl must be a function');

  return (timestamp) => new Promise((resolve) => {
    let image;
    try {
      image = createImage();
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    let timeout;
    const cleanup = () => {
      image.onload = null;
      image.onerror = null;
      if (timeout !== undefined) cancelSchedule(timeout);
    };
    const finish = (available) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(available);
    };

    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => finish(false);
    timeout = schedule(() => {
      const activeImage = image;
      finish(false);
      try {
        activeImage.src = CANCELLED_IMAGE_SOURCE;
      } catch {
        // The result has already settled; an unusual Image implementation may
        // reject the best-effort cancellation assignment.
      }
    }, timeoutMs);
    if (settled) return;
    try {
      image.src = buildUrl(timestamp);
    } catch {
      finish(false);
    }
  });
}
