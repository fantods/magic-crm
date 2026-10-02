import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot } from '@formless/core';
import { ModelCallFailure } from './errors.js';
import { OpenAiQueryPlannerModel } from './models.js';
import type { FetchInitLike, FetchLike, FetchResponseLike, ModelCallMetadata } from './index.js';

const schema: SchemaSnapshot = {
  tables: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'leads',
      aliases: [],
      columns: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'locations_count',
          type: 'integer',
          aliases: [],
        },
        {
          id: '00000000-0000-4000-8000-000000000003',
          name: 'budget',
          type: 'integer',
          aliases: [],
        },
      ],
    },
  ],
};

const queryPlanWire = {
  query: {
    tableId: '00000000-0000-4000-8000-000000000001',
    filter: {
      kind: 'comparison',
      columnId: '00000000-0000-4000-8000-000000000003',
      operator: 'gt',
      value: 5000,
    },
    orderBy: { columnId: '00000000-0000-4000-8000-000000000003', direction: 'desc' },
    limit: null,
  },
  interpretation: 'Leads whose budget column value is greater than 5000, highest first.',
  warnings: [],
};

function okResponse(payload: unknown): FetchResponseLike {
  return {
    status: 200,
    headers: { get: () => 'req_test' },
    text: async () => JSON.stringify(payload),
  };
}

function modelCompletion(output: unknown): FetchResponseLike {
  return okResponse({
    id: 'resp_test',
    object: 'response',
    status: 'completed',
    output: [
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }],
      },
    ],
    usage: { input_tokens: 11, output_tokens: 7, total_tokens: 18 },
  });
}

interface Harness {
  readonly inits: FetchInitLike[];
  readonly metadata: ModelCallMetadata[];
  makeModel(
    responses: Array<FetchResponseLike | Error>,
    options?: { maxAttempts?: number },
  ): OpenAiQueryPlannerModel;
}

function harness(): Harness {
  const inits: FetchInitLike[] = [];
  const metadata: ModelCallMetadata[] = [];
  return {
    inits,
    metadata,
    makeModel(responses, options = {}) {
      let index = 0;
      const fetchImpl: FetchLike = async (_url, init) => {
        inits.push(init);
        const next = responses[index];
        index += 1;
        if (next === undefined) {
          throw new Error('unexpected fetch call');
        }
        if (next instanceof Error) {
          throw next;
        }
        return next;
      };
      return new OpenAiQueryPlannerModel({
        apiKey: 'sk-test',
        fetch: fetchImpl,
        sleep: async () => {},
        now: () => 1_000,
        onCall: (call) => metadata.push(call),
        retry: { maxAttempts: options.maxAttempts ?? 3, initialDelayMs: 1 },
      });
    },
  };
}

describe('OpenAiQueryPlannerModel', () => {
  it('returns the parsed plan from a completed structured response', async () => {
    const harnessState = harness();
    const model = harnessState.makeModel([modelCompletion(queryPlanWire)]);

    const plan = await model.plan({ question: 'Which leads have a budget over 5000?', schema });

    expect(plan.query.tableId).toBe('00000000-0000-4000-8000-000000000001');
    expect(plan.query.filter).toEqual({
      kind: 'comparison',
      columnId: '00000000-0000-4000-8000-000000000003',
      operator: 'gt',
      value: 5000,
    });
    expect(plan.interpretation).toContain('greater than 5000');
    expect(plan.warnings).toEqual([]);
    expect('workspaceId' in plan.query).toBe(false);

    expect(harnessState.inits).toHaveLength(1);
    const body = JSON.parse(String(harnessState.inits[0]?.body)) as {
      text: { format: { name: string; strict: boolean } };
    };
    expect(body.text.format.name).toBe('query_plan');
    expect(body.text.format.strict).toBe(true);

    expect(harnessState.metadata).toHaveLength(1);
    expect(harnessState.metadata[0]?.purpose).toBe('query_planning');
    expect(harnessState.metadata[0]?.totalTokens).toBe(18);
  });

  it('normalizes strict-mode nulls for absent optional fields', async () => {
    const harnessState = harness();
    const model = harnessState.makeModel([
      modelCompletion({
        ...queryPlanWire,
        query: { ...queryPlanWire.query, filter: null, orderBy: null, limit: null },
      }),
    ]);

    const plan = await model.plan({ question: 'Show all leads.', schema });

    expect(plan.query.filter).toBeUndefined();
    expect(plan.query.orderBy).toBeUndefined();
    expect(plan.query.limit).toBeUndefined();
  });

  it('retries transient server failures and succeeds on a later attempt', async () => {
    const harnessState = harness();
    const model = harnessState.makeModel([
      new Error('connection reset'),
      modelCompletion(queryPlanWire),
    ]);

    const plan = await model.plan({ question: 'Which leads?', schema });

    expect(plan.query.tableId).toBe('00000000-0000-4000-8000-000000000001');
    expect(harnessState.inits).toHaveLength(2);
  });

  it('fails with a normalized ModelCallFailure on schema-invalid output', async () => {
    const harnessState = harness();
    const model = harnessState.makeModel([
      modelCompletion({
        query: {
          tableId: '00000000-0000-4000-8000-000000000001',
          filter: { kind: 'comparison', columnId: 'nope', operator: 'between', value: 1 },
          orderBy: null,
          limit: null,
        },
        interpretation: 'broken',
        warnings: [],
      }),
    ]);

    const failure = await model
      .plan({ question: 'Which leads?', schema })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelCallFailure);
    expect((failure as ModelCallFailure).kind).toBe('invalid_output');
    expect((failure as ModelCallFailure).details.purpose).toBe('query_planning');
    expect(harnessState.inits).toHaveLength(1); // invalid output is never retried
  });
});
