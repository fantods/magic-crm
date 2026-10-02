import type { ColumnType } from '@formless/contracts';

export class ColumnValueError extends Error {
  constructor(
    readonly expectedType: ColumnType,
    readonly value: unknown,
  ) {
    super(`Value ${JSON.stringify(value)} is not compatible with column type ${expectedType}`);
    this.name = 'ColumnValueError';
  }
}

export function coerceColumnValue(type: ColumnType, value: unknown): unknown {
  switch (type) {
    case 'text':
    case 'email':
    case 'url':
      if (typeof value !== 'string') {
        throw new ColumnValueError(type, value);
      }
      return value.trim();
    case 'integer': {
      if (typeof value === 'number' && Number.isSafeInteger(value)) {
        return value;
      }
      if (typeof value === 'string' && /^[-+]?\d+$/.test(value.trim())) {
        return Number(value.trim());
      }
      throw new ColumnValueError(type, value);
    }
    case 'decimal': {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === 'string' && Number.isFinite(Number(value.trim()))) {
        return Number(value.trim());
      }
      throw new ColumnValueError(type, value);
    }
    case 'boolean':
      if (typeof value === 'boolean') {
        return value;
      }
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true') return true;
        if (normalized === 'false') return false;
      }
      throw new ColumnValueError(type, value);
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new ColumnValueError(type, value);
      }
      if (Number.isNaN(Date.parse(value))) {
        throw new ColumnValueError(type, value);
      }
      return value;
    case 'datetime':
      if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
        throw new ColumnValueError(type, value);
      }
      return new Date(value).toISOString();
    case 'enum':
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ColumnValueError(type, value);
      }
      return value.trim();
    case 'json':
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new ColumnValueError(type, value);
      }
      return value;
  }
}

export function validateConstrainedValue(
  type: ColumnType,
  value: unknown,
  enumValues?: readonly string[],
): unknown {
  const coerced = coerceColumnValue(type, value);

  if (type === 'enum' && enumValues && !enumValues.includes(String(coerced))) {
    throw new ColumnValueError(type, value);
  }

  if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(coerced))) {
    throw new ColumnValueError(type, value);
  }

  if (type === 'url' && !/^https?:\/\/[^\s]+$/i.test(String(coerced))) {
    throw new ColumnValueError(type, value);
  }

  return coerced;
}
