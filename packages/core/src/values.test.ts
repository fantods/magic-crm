import { describe, expect, it } from 'vitest';
import { ColumnValueError, coerceColumnValue, validateConstrainedValue } from './values.js';

describe('column values', () => {
  it('coerces safe numeric and boolean strings', () => {
    expect(coerceColumnValue('integer', '18')).toBe(18);
    expect(coerceColumnValue('decimal', '6500.50')).toBe(6500.5);
    expect(coerceColumnValue('boolean', 'true')).toBe(true);
  });

  it('normalizes dates and rejects invalid ones', () => {
    expect(validateConstrainedValue('date', '2026-10-02')).toBe('2026-10-02');
    expect(validateConstrainedValue('datetime', '2026-10-02T10:00:00-04:00')).toBe(
      '2026-10-02T14:00:00.000Z',
    );
    expect(() => validateConstrainedValue('date', 'not-a-date')).toThrow(ColumnValueError);
  });

  it('validates enum values', () => {
    expect(validateConstrainedValue('enum', 'high', ['low', 'high'])).toBe('high');
    expect(() => validateConstrainedValue('enum', 'urgent', ['low', 'high'])).toThrow(
      ColumnValueError,
    );
  });
});
