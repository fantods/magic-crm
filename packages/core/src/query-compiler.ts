import {
  isoDateTimeSchema,
  type ColumnType,
  type QueryFilter,
  type RecordQuery,
} from '@formless/contracts';
import type { SchemaColumnSnapshot } from './schema-snapshot.js';

/**
 * Compile-time cap on the number of records a query may return (PLAN.md,
 * "Safety rules": limit is capped at 200).
 */
export const MAX_QUERY_LIMIT = 200;

/** Upper bound on filter nodes, so a hostile or looping model output cannot grow unbounded. */
export const MAX_FILTER_NODES = 200;

/** Upper bound on logical nesting depth. */
export const MAX_FILTER_DEPTH = 20;

/** Thrown when a structurally validated query violates a compile-time safety rule. */
export class QueryCompileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryCompileError';
  }
}

/** A parameterized, read-only SQL statement over the fixed `records` table. */
export interface CompiledRecordQuery {
  readonly text: string;
  readonly params: readonly unknown[];
  /** The executed limit after applying {@link MAX_QUERY_LIMIT}. */
  readonly limit: number;
}

export interface CompileRecordQueryInput {
  readonly query: RecordQuery;
  /** The columns of the selected table, loaded from the workspace catalog. */
  readonly columns: readonly SchemaColumnSnapshot[];
}

const TEXTUAL_TYPES: ReadonlySet<ColumnType> = new Set(['text', 'email', 'url', 'enum', 'json']);

const COMPARABLE_TYPES: ReadonlySet<ColumnType> = new Set([
  'text',
  'email',
  'url',
  'enum',
  'integer',
  'decimal',
  'date',
  'datetime',
]);

/** SQL cast applied to `(data->>'column')` and to the bound value, per column type. */
const CAST_BY_TYPE: Partial<Record<ColumnType, string>> = {
  integer: 'numeric',
  decimal: 'numeric',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamptz',
};

/**
 * Compiles an already-validated `RecordQuery` into one parameterized SELECT
 * over the fixed `records` table.
 *
 * Safety rules enforced here (PLAN.md, "Safety rules"):
 * - the workspace and table IDs appear as parameters in every compiled
 *   statement, so workspace isolation cannot be omitted;
 * - every referenced column ID must exist in the catalog columns of the
 *   selected table; internal IDs are the only identifiers used;
 * - values are validated against the column type in TypeScript and bound as
 *   parameters, so PostgreSQL never casts an unexpected value;
 * - the limit is capped at {@link MAX_QUERY_LIMIT};
 * - the output is a single read-only SELECT; no statement terminator and no
 *   mutating keyword can enter the text.
 */
export function compileRecordQuery(input: CompileRecordQueryInput): CompiledRecordQuery {
  const { query, columns } = input;
  if (query.workspaceId.length === 0) {
    throw new QueryCompileError('Query workspace id must not be empty');
  }
  if (query.tableId.length === 0) {
    throw new QueryCompileError('Query table id must not be empty');
  }

  const byId = new Map(columns.map((column) => [column.id, column]));
  const params: unknown[] = [query.workspaceId, query.tableId];
  /** Binds a value and returns its placeholder, e.g. `$3`. */
  const bind = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  const requireColumn = (columnId: string): SchemaColumnSnapshot => {
    const column = byId.get(columnId);
    if (!column) {
      throw new QueryCompileError(
        `Query references column ${columnId} that does not exist in table ${query.tableId}`,
      );
    }
    return column;
  };

  const columnKeyParam = (columnId: string): string => bind(columnId);

  let filterSql = '';
  if (query.filter !== undefined) {
    checkFilterSize(query.filter);
    filterSql = ` AND ${compileFilter(query.filter)}`;
  }

  let orderBySql = 'ORDER BY created_at DESC';
  if (query.orderBy !== undefined) {
    const column = requireColumn(query.orderBy.columnId);
    assertOrderable(column.type);
    const keyParam = columnKeyParam(column.id);
    const cast = CAST_BY_TYPE[column.type];
    const expression = cast
      ? `(data->>${keyParam}::text)::${cast}`
      : `(data->>${keyParam}::text)::text`;
    orderBySql = `ORDER BY ${expression} ${query.orderBy.direction === 'asc' ? 'ASC' : 'DESC'}`;
  }

  const limit = clampLimit(query.limit);
  const limitParam = bind(limit);

  const text = [
    'SELECT id, workspace_id, table_id, data, evidence, source, schema_revision, content_hash, idempotency_key, created_at',
    'FROM records',
    `WHERE workspace_id = $1 AND table_id = $2${filterSql}`,
    orderBySql,
    `LIMIT ${limitParam}`,
  ].join('\n');

  return { text, params, limit };

  function compileFilter(filter: QueryFilter): string {
    if (filter.kind === 'logical') {
      const children = filter.children.map((child) => compileFilter(child));
      const joined = children.join(filter.operator === 'or' ? ' OR ' : ' AND ');
      return children.length === 1 ? joined : `(${joined})`;
    }

    const column = requireColumn(filter.columnId);
    const keyParam = columnKeyParam(column.id);
    const lhs = `(data->>${keyParam}::text)`;

    if (filter.value === null) {
      if (filter.operator === 'eq') {
        return `${lhs} IS NULL`;
      }
      if (filter.operator === 'neq') {
        return `${lhs} IS NOT NULL`;
      }
      throw new QueryCompileError(
        `Operator ${filter.operator} cannot be used with a null value on column ${column.id}`,
      );
    }

    const cast = CAST_BY_TYPE[column.type];
    const typedLhs = cast ? `${lhs}::${cast}` : lhs;
    const valueParam = (value: unknown): string =>
      `${bind(validateValue(column, filter.operator, value))}::${cast ?? 'text'}`;

    switch (filter.operator) {
      case 'eq':
        return `${typedLhs} = ${valueParam(filter.value)}`;
      case 'neq':
        return `${typedLhs} <> ${valueParam(filter.value)}`;
      case 'contains': {
        if (!TEXTUAL_TYPES.has(column.type)) {
          throw new QueryCompileError(
            `Operator contains is only supported on textual columns, not ${column.type}`,
          );
        }
        params.push(escapeLikePattern(expectString(column, filter.value)));
        return `${lhs} ILIKE ('%' || $${params.length}::text || '%')`;
      }
      case 'in': {
        if (!Array.isArray(filter.value)) {
          throw new QueryCompileError(
            `Operator in requires an array of values on column ${column.id}`,
          );
        }
        const values = filter.value.map((value) => validateValue(column, 'eq', value));
        params.push(values);
        return `${typedLhs} = ANY($${params.length}::${cast ?? 'text'}[])`;
      }
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte': {
        assertComparable(column.type);
        const symbol = { gt: '>', gte: '>=', lt: '<', lte: '<=' }[filter.operator];
        return `${typedLhs} ${symbol} ${valueParam(filter.value)}`;
      }
    }
  }
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? MAX_QUERY_LIMIT;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_QUERY_LIMIT);
}

function checkFilterSize(filter: QueryFilter): void {
  let nodes = 0;
  const stack: Array<{ node: QueryFilter; depth: number }> = [{ node: filter, depth: 1 }];

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) {
      break;
    }
    nodes += 1;
    if (nodes > MAX_FILTER_NODES) {
      throw new QueryCompileError(`Query filter exceeds the maximum of ${MAX_FILTER_NODES} nodes`);
    }
    if (entry.depth > MAX_FILTER_DEPTH) {
      throw new QueryCompileError(
        `Query filter exceeds the maximum nesting depth of ${MAX_FILTER_DEPTH}`,
      );
    }
    if (entry.node.kind === 'logical') {
      for (const child of entry.node.children) {
        stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
}

function assertComparable(type: ColumnType): void {
  if (!COMPARABLE_TYPES.has(type)) {
    throw new QueryCompileError(`Operator gt/gte/lt/lte is not supported on ${type} columns`);
  }
}

function assertOrderable(type: ColumnType): void {
  if (type === 'json') {
    throw new QueryCompileError('Ordering by json columns is not supported');
  }
}

function expectString(column: SchemaColumnSnapshot, value: unknown): string {
  if (typeof value !== 'string') {
    throw new QueryCompileError(
      `Column ${column.id} of type ${column.type} requires a string value`,
    );
  }
  return value;
}

/**
 * Validates one comparison value against the column type in TypeScript, so a
 * value that could not be cast by PostgreSQL never reaches the statement.
 * Returns the parameter exactly as bound.
 */
function validateValue(column: SchemaColumnSnapshot, operator: string, value: unknown): unknown {
  const require = (condition: boolean, expectation: string): void => {
    if (!condition) {
      throw new QueryCompileError(
        `Column ${column.id} of type ${column.type} requires ${expectation} for ${operator}`,
      );
    }
  };

  switch (column.type) {
    case 'text':
    case 'email':
    case 'url':
    case 'enum':
      require(typeof value === 'string' && value.length > 0, 'a non-empty string');
      return value;
    case 'json': {
      // JSON columns compare by their canonical JSON text.
      require(typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean', 'a string, number, or boolean');
      return JSON.stringify(value);
    }
    case 'integer':
      require(typeof value === 'number' && Number.isInteger(value), 'an integer number');
      return value;
    case 'decimal':
      require(typeof value === 'number' && Number.isFinite(value), 'a finite number');
      return value;
    case 'boolean':
      require(typeof value === 'boolean', 'a boolean');
      return value;
    case 'date': {
      require(typeof value === 'string' && isCalendarDate(value), 'a YYYY-MM-DD date string');
      return value;
    }
    case 'datetime': {
      require(typeof value === 'string' &&
        isoDateTimeSchema.safeParse(value).success, 'an ISO 8601 datetime string');
      return value;
    }
  }
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

/**
 * Escapes LIKE wildcards so `contains` matches the literal user text.
 * PostgreSQL's default escape character (backslash) is used.
 */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
