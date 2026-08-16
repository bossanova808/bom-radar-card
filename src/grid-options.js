export function getFixedHeightGridOptions(mapHeight) {
  const rows = Math.max(4, Math.ceil((mapHeight + 8) / 64));
  return {
    rows,
    min_rows: rows,
    max_rows: rows,
    columns: 12,
    min_columns: 6,
    max_columns: 12,
  };
}
