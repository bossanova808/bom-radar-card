const DEFAULT_RETRY_DELAY_MS = 1000;

export function loadImageWithRetry(image, sourceUrl, fallbackUrl, done, options = {}) {
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const schedule = options.schedule ?? setTimeout;
  let hasRetried = false;
  let isDone = false;

  const finish = () => {
    if (isDone) return;
    isDone = true;
    done();
  };

  image.onload = finish;
  const handleError = () => {
    if (!hasRetried) {
      hasRetried = true;
      schedule(() => {
        if (
          !isDone &&
          image.onerror === handleError &&
          image.getAttribute('src') === sourceUrl
        ) {
          image.src = sourceUrl;
        }
      }, retryDelayMs);
      return;
    }

    image.onerror = null;
    image.src = fallbackUrl;
    finish();
  };
  image.onerror = handleError;
  image.src = sourceUrl;
}
