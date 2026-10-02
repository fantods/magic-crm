import { describe, expect, it } from 'vitest';
import type { RecordQuery } from '@formless/contracts';
import type { SchemaColumnSnapshot } from './schema-snapshot.js';
import { MAX_QUERY_LIMIT, QueryCompileError, compileRecordQuery } from './query-compiler.js';

const WORKSPACE_ID = 'query-workspace';
const TABLE_ID = '00000000-0000-4000-8000-000000000001';

function column(
  id: string,
  type: SchemaColumnSnapshot['type'],
  name = id.slice(0, 8),
): SchemaColumnSnapshot {
  return { id, name, type, aliases: [] };
}

const leadsTableColumns: SchemaColumnSnapshot[] = [
  column('00000000-0000-4000-8000-0000000000b1', 'integer', 'locations_count'),
  column('00000000-0000-4000-8000-0000000000b2', 'integer', 'budget'),
  column('00000000-0000-4000-8000-0000000000b3', 'text', 'company_name'),
  column('00000000-0000-4000-8000-0000000000b4', 'decimal', 'score'),
  column('00000000-0000-4000-8000-0000000000b5', 'boolean', 'blocked'),
  column('00000000-0000-4000-8000-0000000000b6', 'date', 'start_date'),
  column('00000000-0000-4000-8000-0000000000b7', 'datetime', 'received_at'),
  column('00000000-0000-4000-8000-0000000000b8', 'enum', 'stage'),
  column('00000000-0000-4000-8000-0000000000b9', 'email', 'contact_email'),
  column('00000000-0000-4000-8000-0000000000ba', 'url', 'website'),
  column('00000000-0000-4000-8000-0000000000bb', 'json', 'metadata'),
];

const BUDGET = '00000000-0000-4000-8000-0000000000b2';

function compile(query: Partial<RecordQuery>): ReturnType<typeof compileRecordQuery> {
  return compileRecordQuery({
    columns: leadsTableColumns,
    query: { workspaceId: WORKSPACE_ID, tableId: TABLE_ID, ...query },
  });
}

describe('record query compiler', () => {
  it('compiles a minimal query with workspace and table isolation and capped limit', () => {
    const compiled = compile({});

    expect(compiled.text).toContain('FROM records');
    expect(compiled.text).toContain('WHERE workspace_id = $1 AND table_id = $2');
    expect(compiled.text).not.toContain(';');
    expect(compiled.text.trimStart().startsWith('SELECT')).toBe(true);
    expect(compiled.params[0]).toBe(WORKSPACE_ID);
    expect(compiled.params[1]).toBe(TABLE_ID);
    expect(compiled.limit).toBe(MAX_QUERY_LIMIT);
    expect(compiled.text).toContain(`LIMIT $${compiled.params.length}`);
    expect(compiled.params.at(-1)).toBe(MAX_QUERY_LIMIT);
    expect(compiled.text).toContain('ORDER BY created_at DESC');
  });

  it('compiles a numeric comparison with the column id and value bound as parameters', () => {
    const compiled = compile({
      filter: { kind: 'comparison', columnId: BUDGET, operator: 'gt', value: 5000 },
    });

    expect(compiled.text).toContain(`(data->>$3::text)::numeric > $4::numeric`);
    expect(compiled.params).toEqual([WORKSPACE_ID, TABLE_ID, BUDGET, 5000, MAX_QUERY_LIMIT]);
  });

  it('compiles eq/neq per column type with the matching casts', () => {
    const cases: Array<[string, string, unknown, string]> = [
      [BUDGET, 'eq', 3, '::numeric = $4::numeric'],
      ['00000000-0000-4000-8000-0000000000b4', 'neq', 1.5, '::numeric <> $4::numeric'],
      ['00000000-0000-4000-8000-0000000000b5', 'eq', true, '::boolean = $4::boolean'],
      ['00000000-0000-4000-8000-0000000000b6', 'eq', '2025-03-01', '::date = $4::date'],
      [
        '00000000-0000-4000-8000-0000000000b7',
        'gte',
        '2025-03-01T00:00:00.000Z',
        '::timestamptz >= $4::timestamptz',
      ],
      ['00000000-0000-4000-8000-0000000000b3', 'eq', 'acme', ' = $4::text'],
      ['00000000-0000-4000-8000-0000000000b8', 'eq', 'new', ' = $4::text'],
      ['00000000-0000-4000-8000-0000000000b9', 'eq', 'a@b.co', ' = $4::text'],
      ['00000000-0000-4000-8000-0000000000ba', 'eq', 'https://a.co', ' = $4::text'],
      ['00000000-0000-4000-8000-0000000000bb', 'eq', 7, ' = $4::text'],
    ];

    for (const [columnId, operator, value, expected] of cases) {
      const compiled = compile({
        filter: { kind: 'comparison', columnId, operator, value },
      });
      expect(compiled.text).toContain(`(data->>$3::text)${expected}`);
    }
  });

  it('serializes json column values to their canonical JSON text', () => {
    const compiled = compile({
      filter: {
        kind: 'comparison',
        columnId: '00000000-0000-4000-8000-0000000000bb',
        operator: 'eq',
        value: 7,
      },
    });

    expect(compiled.params[3]).toBe('7');
  });

  it('compiles contains with escaped LIKE wildcards', () => {
    const compiled = compile({
      filter: {
        kind: 'comparison',
        columnId: '00000000-0000-4000-8000-0000000000b3',
        operator: 'contains',
        value: '50%_off\\x',
      },
    });

    expect(compiled.text).toContain(`(data->>$3::text) ILIKE ('%' || $4::text || '%')`);
    expect(compiled.params[3]).toBe('50\\%\\_off\\\\x');
  });

  it('compiles the in operator with array parameters', () => {
    const compiled = compile({
      filter: {
        kind: 'comparison',
        columnId: '00000000-0000-4000-8000-0000000000b8',
        operator: 'in',
        value: ['new', 'won'],
      },
    });

    expect(compiled.text).toContain(`(data->>$3::text) = ANY($4::text[])`);
    expect(compiled.params[3]).toEqual(['new', 'won']);

    const numeric = compile({
      filter: { kind: 'comparison', columnId: BUDGET, operator: 'in', value: [1, 2] },
    });
    expect(numeric.text).toContain(`(data->>$3::text)::numeric = ANY($4::numeric[])`);
    expect(numeric.params[3]).toEqual([1, 2]);
  });

  it('compiles null comparisons to IS NULL / IS NOT NULL', () => {
    const isNull = compile({
      filter: { kind: 'comparison', columnId: BUDGET, operator: 'eq', value: null },
    });
    expect(isNull.text).toContain('(data->>$3::text) IS NULL');

    const notNull = compile({
      filter: { kind: 'comparison', columnId: BUDGET, operator: 'neq', value: null },
    });
    expect(notNull.text).toContain('(data->>$3::text) IS NOT NULL');
  });

  it('groups nested and/or filters with parentheses', () => {
    const compiled = compile({
      filter: {
        kind: 'logical',
        operator: 'or',
        children: [
          { kind: 'comparison', columnId: BUDGET, operator: 'gt', value: 5000 },
          {
            kind: 'logical',
            operator: 'and',
            children: [
              { kind: 'comparison', columnId: BUDGET, operator: 'lte', value: 100 },
              {
                kind: 'comparison',
                columnId: '00000000-0000-4000-8000-0000000000b5',
                operator: 'eq',
                value: false,
              },
            ],
          },
        ],
      },
    });

    expect(compiled.text).toContain(
      '((data->>$3::text)::numeric > $4::numeric OR ((data->>$5::text)::numeric <= $6::numeric AND (data->>$7::text)::boolean = $8::boolean))',
    );
  });

  it('compiles orderBy with the column type cast and direction', () => {
    const compiled = compile({
      orderBy: { columnId: BUDGET, direction: 'desc' },
      filter: { kind: 'comparison', columnId: BUDGET, operator: 'gte', value: 1 },
    });

    expect(compiled.text).toContain('(data->>$5::text)::numeric DESC');
    expect(compiled.params[2]).toBe(BUDGET);
    expect(compiled.params[3]).toBe(1);
    expect(compiled.params[4]).toBe(BUDGET);
  });

  it('clamps the limit at 200 and keeps at least 1', () => {
    expect(compile({ limit: 200 }).limit).toBe(200);
    expect(compile({ limit: 1 }).limit).toBe(1);
    // The compiler is the last line of defense, so even an out-of-contract
    // limit cannot produce an unlimited statement.
    const overLimit = compileRecordQuery({
      columns: leadsTableColumns,
      query: { workspaceId: WORKSPACE_ID, tableId: TABLE_ID, limit: 100_000 },
    });
    expect(overLimit.limit).toBe(MAX_QUERY_LIMIT);
  });

  it('rejects unknown column ids', () => {
    expect(() =>
      compile({ filter: { kind: 'comparison', columnId: 'nope', operator: 'eq', value: 1 } }),
    ).toThrow(QueryCompileError);
    expect(() => compile({ orderBy: { columnId: 'nope', direction: 'asc' } })).toThrow(
      /does not exist in table/,
    );
  });

  it('rejects value/type mismatches with clear messages', () => {
    expect(() =>
      compile({ filter: { kind: 'comparison', columnId: BUDGET, operator: 'eq', value: '5000' } }),
    ).toThrow(/requires an integer number/);
    expect(() =>
      compile({ filter: { kind: 'comparison', columnId: BUDGET, operator: 'eq', value: 1.5 } }),
    ).toThrow(QueryCompileError);
    expect(() =>
      compile({
        filter: {
          kind: 'comparison',
          columnId: '00000000-0000-4000-8000-0000000000b3',
          operator: 'eq',
          value: 7,
        },
      }),
    ).toThrow(/requires a non-empty string/);
    expect(() =>
      compile({
        filter: {
          kind: 'comparison',
          columnId: '00000000-0000-4000-8000-0000000000b6',
          operator: 'eq',
          value: 'March 1st',
        },
      }),
    ).toThrow(/YYYY-MM-DD/);
    expect(() =>
      compile({
        filter: {
          kind: 'comparison',
          columnId: '00000000-0000-4000-8000-0000000000b7',
          operator: 'lt',
          value: 'yesterday',
        },
      }),
    ).toThrow(/ISO 8601/);
  });

  it('rejects unsupported operator/type combinations', () => {
    expect(() =>
      compile({
        filter: { kind: 'comparison', columnId: BUDGET, operator: 'contains', value: '5' },
      }),
    ).toThrow(/contains/);
    expect(() =>
      compile({
        filter: {
          kind: 'comparison',
          columnId: '00000000-0000-4000-8000-0000000000b5',
          operator: 'gt',
          value: true,
        },
      }),
    ).toThrow(/gt\/gte\/lt\/lte/);
    expect(() =>
      compile({ filter: { kind: 'comparison', columnId: BUDGET, operator: 'gt', value: null } }),
    ).toThrow(/null/);
    expect(() =>
      compile({
        filter: { kind: 'comparison', columnId: BUDGET, operator: 'in', value: 5 },
      }),
    ).toThrow(/array/);
    expect(() =>
      compile({ orderBy: { columnId: '00000000-0000-4000-8000-0000000000bb', direction: 'asc' } }),
    ).toThrow(/json/);
  });

  it('rejects oversized and overly deep filters', () => {
    // 5 groups x 50 comparisons = 250 comparison nodes.
    const groups = Array.from({ length: 5 }, () => ({
      kind: 'logical' as const,
      operator: 'and' as const,
      children: Array.from({ length: 50 }, () => ({
        kind: 'comparison' as const,
        columnId: BUDGET,
        operator: 'eq' as const,
        value: 1,
      })),
    }));
    expect(() =>
      compile({ filter: { kind: 'logical', operator: 'or', children: groups } }),
    ).toThrow(/maximum of 200 nodes/);

    let deep: RecordQuery['filter'] = {
      kind: 'comparison',
      columnId: BUDGET,
      operator: 'eq',
      value: 1,
    };
    for (let i = 0; i < 25; i += 1) {
      deep = { kind: 'logical', operator: 'and', children: [deep as NonNullable<typeof deep>] };
    }
    expect(() => compile({ filter: deep })).toThrow(/nesting depth/);
  });
});
