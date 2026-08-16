export function getRoundedUtcDate(
  baseDate,
  stepMinutes,
  anchorHourUtc = null,
  allowFutureDailyAnchor = false,
  roundSubDailyUp = false,
) {
  const rounded = new Date(baseDate);
  rounded.setUTCSeconds(0, 0);

  if (stepMinutes >= 1440) {
    rounded.setUTCMinutes(0, 0, 0);
    rounded.setUTCHours(anchorHourUtc ?? 0);
    if (!allowFutureDailyAnchor && rounded > baseDate) {
      rounded.setUTCDate(rounded.getUTCDate() - 1);
    }
    return rounded;
  }

  const totalMinutes = rounded.getUTCHours() * 60 + rounded.getUTCMinutes();
  const roundCadence = roundSubDailyUp ? Math.ceil : Math.floor;
  const snappedMinutes = roundCadence(totalMinutes / stepMinutes) * stepMinutes;
  rounded.setUTCHours(Math.floor(snappedMinutes / 60), snappedMinutes % 60, 0, 0);
  return rounded;
}

export function generateFallbackTimestamps(layerConfig, count = 9, baseDate = new Date()) {
  const now = new Date(baseDate);
  const stepMinutes = layerConfig?.fallbackStepMinutes || 5;
  const lagMinutes = layerConfig?.fallbackLagMinutes || 0;
  const leadMinutes = layerConfig?.fallbackLeadMinutes || 0;
  const anchorHourUtc = layerConfig?.fallbackAnchorHourUtc ?? null;
  const frameCount = Math.min(count, layerConfig?.fallbackMaxFrames || count);
  const timeMode = layerConfig?.timeMode || 'past';
  const allowFutureDailyAnchor = timeMode === 'forecast' && stepMinutes >= 1440;
  const roundSubDailyUp = timeMode === 'forecast' && stepMinutes < 1440;
  const start = getRoundedUtcDate(
    new Date(now.getTime() + (leadMinutes - lagMinutes) * 60 * 1000),
    stepMinutes,
    anchorHourUtc,
    allowFutureDailyAnchor,
    roundSubDailyUp,
  );

  const timestamps = [];
  for (let i = 0; i < frameCount; i++) {
    const direction = timeMode === 'forecast' ? 1 : -1;
    const stepIndex = timeMode === 'forecast' ? i : frameCount - 1 - i;
    const timestamp = new Date(start.getTime() + direction * stepIndex * stepMinutes * 60 * 1000);
    timestamps.push(timestamp.toISOString().replace(/\.\d{3}Z$/, 'Z'));
  }
  return timestamps;
}
