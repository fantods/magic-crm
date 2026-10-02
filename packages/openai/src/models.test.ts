import { describe, expect, it } from 'vitest';
import { IngestionPlanner, normalizeEmail, type ArchitectProposal } from '@formless/core';
import { ModelCallFailure } from './errors.js';
import { OpenAiArchitectModel, OpenAiReviewerModel } from './models.js';
import { architectProposalJsonSchema, reviewerDecisionJsonSchema } from './structured-schemas.js';
import type { FetchInitLike, FetchLike, FetchResponseLike, ModelCallMetadata } from './index.js';

const clinicEmail = {
  workspaceId: 'demo',
  subject: 'Meridian Health expansion lead',
  body: 'Meridian Health operates three clinics across Ontario and has a budget of 6500.',
  from: 'ops@meridianhealth.example',
  to: 'sales@magiccrm.example',
};

const architectWire = {
  table: { kind: 'new', name: 'Lead', description: null, aliases: ['prospect'] },
  fields: [
    {
      key: 'clinic_count',
      columnName: 'clinics_count',
      type: 'integer',
      value: 3,
      enumValues: null,
      evidence: { source: 'body', text: 'three clinics', startIndex: null, endIndex: null },
      rationale: 'The sender states the number of operated clinics.',
    },
    {
      key: 'budget',
      columnName: 'budget',
      type: 'integer',
      value: 6500,
      enumValues: null,
      evidence: { source: 'body', text: 'budget of 6500', startIndex: null, endIndex: null },
      rationale: 'The stated budget is a durable sales fact.',
    },
  ],
};

const reviewerWire = {
  table: {
    action: 'accept_new',
    name: 'leads',
    description: 'Inbound sales leads',
    aliases: ['prospect', 'opportunity'],
    rationale: 'The email is a distinct sales lead, not a support request.',
  },
  fields: [
    {
      action: 'accept_new',
      fieldKey: 'clinic_count',
      columnName: 'locations_count',
      type: 'integer',
      enumValues: null,
      rationale: 'Clinic count is a repeatable site count concept; use a generic column name.',
    },
    {
      action: 'accept_new',
      fieldKey: 'budget',
      columnName: 'budget',
      type: 'integer',
      enumValues: null,
      rationale: 'Budget is durable and useful for lead qualification.',
    },
  ],
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
    usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
  });
}

function fetchPlan(responses: Array<FetchResponseLike | Error>): {
  fetch: FetchLike;
  requests: { url: string; init: FetchInitLike }[];
} {
  const requests: { url: string; init: FetchInitLike }[] = [];
  let index = 0;
  const fetch: FetchLike = async (url, init) => {
    requests.push({ url, init });
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
  return { fetch, requests };
}

describe('OpenAiArchitectModel', () => {
  it('proposes through the Responses API and normalizes the wire output', async () => {
    const metadata: ModelCallMetadata[] = [];
    const { fetch, requests } = fetchPlan([modelCompletion(architectWire)]);
    const architect = new OpenAiArchitectModel({
      apiKey: 'sk-test',
      fetch,
      sleep: async () => undefined,
      onCall: (entry) => metadata.push(entry),
    });

    const proposal = await architect.propose({
      email: normalizeEmail(clinicEmail),
      schema: { tables: [] },
    });

    expect(proposal.table).toEqual({ kind: 'new', name: 'Lead', aliases: ['prospect'] });
    expect(proposal.fields[0]?.evidence).toEqual({ source: 'body', text: 'three clinics' });

    const body = JSON.parse(requests[0]!.init.body) as {
      input: { role: string; content: string }[];
      text: { format: { schema: unknown } };
    };
    expect(body.text.format.schema).toEqual(architectProposalJsonSchema);
    expect(body.input[0]!.content).toContain('schema architect');
    const userPayload = JSON.parse(body.input[1]!.content) as { email: { body: string } };
    expect(userPayload.email.body).toContain('three clinics');

    expect(metadata).toHaveLength(1);
    expect(metadata[0]).toMatchObject({
      purpose: 'architect_proposal',
      model: 'gpt-5.1',
      attempts: 1,
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      requestId: 'req_test',
      responseId: 'resp_test',
    });
  });

  it('rejects schema-invalid model output with a typed failure', async () => {
    const { fetch } = fetchPlan([modelCompletion({ table: { kind: 'nonsense' }, fields: [] })]);
    const architect = new OpenAiArchitectModel({
      apiKey: 'sk-test',
      fetch,
      sleep: async () => undefined,
    });

    const failure = await architect
      .propose({ email: normalizeEmail(clinicEmail), schema: { tables: [] } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelCallFailure);
    expect((failure as ModelCallFailure).kind).toBe('invalid_output');
  });
});

describe('OpenAiReviewerModel', () => {
  it('reviews the architect proposal and records reviewer metadata', async () => {
    const metadata: ModelCallMetadata[] = [];
    const { fetch, requests } = fetchPlan([modelCompletion(reviewerWire)]);
    const reviewer = new OpenAiReviewerModel({
      apiKey: 'sk-test',
      model: 'gpt-5.1-mini',
      fetch,
      sleep: async () => undefined,
      onCall: (entry) => metadata.push(entry),
      policy: { rules: ['Prefer plural snake_case table names.'] },
    });

    const proposal: ArchitectProposal = {
      table: { kind: 'new', name: 'Lead', aliases: ['prospect'] },
      fields: architectWire.fields.map((field) => ({
        key: field.key,
        columnName: field.columnName,
        type: 'integer' as const,
        value: field.value,
        evidence: { source: 'body' as const, text: (field.evidence as { text: string }).text },
        rationale: field.rationale,
      })),
    };

    const decision = await reviewer.review({
      email: normalizeEmail(clinicEmail),
      schema: { tables: [] },
      proposal,
    });

    expect(decision.table.action).toBe('accept_new');
    expect(decision.fields).toHaveLength(2);

    const body = JSON.parse(requests[0]!.init.body) as {
      model: string;
      input: { role: string; content: string }[];
      text: { format: { schema: unknown } };
    };
    expect(body.model).toBe('gpt-5.1-mini');
    expect(body.text.format.schema).toEqual(reviewerDecisionJsonSchema);
    expect(body.input[0]!.content).toContain('gatekeeper');
    expect(body.input[0]!.content).toContain('Prefer plural snake_case table names.');

    expect(metadata[0]).toMatchObject({ purpose: 'reviewer_decision', model: 'gpt-5.1-mini' });
  });
});

describe('planner compatibility', () => {
  it('drives the deterministic ingestion pipeline network-free', async () => {
    const { fetch } = fetchPlan([modelCompletion(architectWire), modelCompletion(reviewerWire)]);
    const clientOptions = {
      apiKey: 'sk-test',
      fetch,
      sleep: async () => undefined,
    };

    let id = 0;
    const planner = new IngestionPlanner(
      new OpenAiArchitectModel(clientOptions),
      new OpenAiReviewerModel(clientOptions),
      () => `generated-${id++}`,
    );

    const planned = await planner.plan(clinicEmail, { tables: [] }, 0);

    expect(planned.plan.table.name).toBe('leads');
    expect(planned.plan.table.isNew).toBe(true);
    expect(planned.plan.columns.map((column) => column.name)).toEqual([
      'locations_count',
      'budget',
    ]);
    expect(planned.plan.record.data).toEqual({ 'generated-1': 3, 'generated-2': 6500 });
    expect(planned.email.idempotencyKey).toBe(`email_${planned.email.contentHash}`);
  });
});
