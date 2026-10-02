import { describe, expect, it } from 'vitest';
import {
  naturalLanguageQueryInputSchema,
  queryPlanOutputSchema,
  queryResponseSchema,
  recordQuerySchema,
  type QueryFilter,
} from './index.js';

const workspaceId = 'demo-workspace';
const tableId = '00000000-0000-4000-8000-000000000001';
const columnId = '00000000-0000-4000-8000-000000000002';

describe('query DSL contracts', () => {
  it('accepts a flat comparison query', () => {
    const parsed = recordQuerySchema.parse({
      workspaceId,
      tableId,
      filter: { kind: 'comparison', columnId, operator: 'gt', value: 5000 },
      limit: 50,
    });

    expect(parsed.filter).toEqual({
      kind: 'comparison',
      columnId,
      operator: 'gt',
      value: 5000,
    });
  });

  it('accepts nested and/or filters with orderBy', () => {
    const filter: QueryFilter = {
      kind: 'logical',
      operator: 'or',
      children: [
        { kind: 'comparison', columnId, operator: 'eq', value: 'acme' },
        {
          kind: 'logical',
          operator: 'and',
          children: [
            { kind: 'comparison', columnId, operator: 'gte', value: 100 },
            { kind: 'comparison', columnId, operator: 'contains', value: 'clinic' },
          ],
        },
      ],
    };

    const parsed = recordQuerySchema.parse({
      workspaceId,
      tableId,
      filter,
      orderBy: { columnId, direction: 'desc' },
    });

    expect(parsed.filter).toEqual(filter);
    expect(parsed.orderBy).toEqual({ columnId, direction: 'desc' });
  });

  it('accepts the null and in value forms', () => {
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'comparison', columnId, operator: 'eq', value: null },
      }),
    ).not.toThrow();
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: {
          kind: 'comparison',
          columnId,
          operator: 'in',
          value: ['a', 2, 'c'],
        },
      }),
    ).not.toThrow();
  });

  it('rejects unknown operators, kinds, and directions', () => {
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'comparison', columnId, operator: 'between', value: 1 },
      }),
    ).toThrow();
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'fuzzy', columnId, operator: 'eq', value: 1 },
      }),
    ).toThrow();
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        orderBy: { columnId, direction: 'sideways' },
      }),
    ).toThrow();
  });

  it('rejects empty logical children and empty in arrays', () => {
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'logical', operator: 'and', children: [] },
      }),
    ).toThrow();
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'comparison', columnId, operator: 'in', value: [] },
      }),
    ).toThrow();
  });

  it('rejects object values and non-integer limits', () => {
    expect(() =>
      recordQuerySchema.parse({
        workspaceId,
        tableId,
        filter: { kind: 'comparison', columnId, operator: 'eq', value: { nested: true } },
      }),
    ).toThrow();
    expect(() => recordQuerySchema.parse({ workspaceId, tableId, limit: 20.5 })).toThrow();
    expect(() => recordQuerySchema.parse({ workspaceId, tableId, limit: 0 })).toThrow();
    expect(() => recordQuerySchema.parse({ workspaceId, tableId, limit: 201 })).toThrow();
  });

  it('rejects invalid workspace ids and missing table ids', () => {
    expect(() => recordQuerySchema.parse({ workspaceId: 'Not A Slug', tableId })).toThrow();
    expect(() => recordQuerySchema.parse({ workspaceId })).toThrow();
  });

  it('validates the natural-language query input', () => {
    expect(naturalLanguageQueryInputSchema.parse({ question: '  Which leads?  ' })).toEqual({
      question: 'Which leads?',
    });
    expect(() => naturalLanguageQueryInputSchema.parse({ question: '   ' })).toThrow();
    expect(() => naturalLanguageQueryInputSchema.parse({})).toThrow();
    expect(() => naturalLanguageQueryInputSchema.parse({ question: 'q', tableId: '' })).toThrow();
  });

  it('validates the planner output shape without the workspace', () => {
    const plan = queryPlanOutputSchema.parse({
      query: {
        tableId,
        filter: { kind: 'comparison', columnId, operator: 'gt', value: 5000 },
      },
      interpretation: 'Leads with a budget above 5000.',
      warnings: [],
    });

    expect(plan.query.tableId).toBe(tableId);
    expect('workspaceId' in plan.query).toBe(false);

    expect(() =>
      queryPlanOutputSchema.parse({
        query: { tableId },
        interpretation: '',
        warnings: [],
      }),
    ).toThrow();
    expect(() =>
      queryPlanOutputSchema.parse({
        query: { tableId },
        interpretation: 'ok',
        warnings: 'none',
      }),
    ).toThrow();
  });

  it('validates the query response contract', () => {
    const record = {
      id: '00000000-0000-4000-8000-0000000000aa',
      workspaceId,
      tableId,
      data: { budget: 6500 },
      evidence: {},
      source: { body: 'budget of 6500' },
      schemaRevision: 1,
      contentHash: 'a'.repeat(64),
      idempotencyKey: 'idempotency-key-1',
      createdAt: '2025-01-01T00:00:00.000Z',
    };

    const response = queryResponseSchema.parse({
      query: { workspaceId, tableId, limit: 200 },
      interpretation: 'All leads.',
      warnings: [],
      records: [record],
    });

    expect(response.records).toHaveLength(1);
    expect(() =>
      queryResponseSchema.parse({
        query: { workspaceId, tableId },
        interpretation: 'All leads.',
        warnings: [],
        records: [{ ...record, id: 'not-a-uuid' }],
      }),
    ).toThrow();
  });
});
