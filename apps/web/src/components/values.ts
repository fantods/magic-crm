/** Display formatting helpers shared by the demo panels. */

/** Formats a canonical record value for display in grids. */
export function formatCellValue(value: unknown): string {
  if (value === undefined || value === null) {
    return '—';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

/** Formats a query value for the interpreted-query display. */
export function formatQueryValue(
  value: string | number | boolean | null | Array<string | number>,
): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatQueryValue(item)).join(', ')}]`;
  }
  if (typeof value === 'string') {
    return `"${value}"`;
  }
  if (value === null) {
    return 'null';
  }
  return String(value);
}
