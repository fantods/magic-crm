import { describe, expect, it } from 'vitest';
import type { ArchitectProposal, ReviewerDecision } from './model-contracts.js';
import { normalizeEmail } from './normalize-email.js';
import { calculateIngestionPlan, ReviewerRejectionError } from './ingestion-plan.js';
import type { SchemaSnapshot } from './schema-snapshot.js';

const email = normalizeEmail({
  workspaceId: 'demo',
  body: 'Meridian Health operates three clinics and has a budget of 6500.',
});

const firstProposal: ArchitectProposal = {
  table: { kind: 'new', name: 'Lead', aliases: ['prospect'] },
  fields: [
    {
      key: 'clinic_count',
      columnName: 'clinics_count',
      type: 'integer',
      value: 3,
      evidence: { source: 'body', text: 'three clinics' },
      rationale: 'Site count',
    },
    {
      key: 'budget',
      columnName: 'budget',
      type: 'integer',
      value: 6500,
      evidence: { source: 'body', text: 'budget of 6500' },
      rationale: 'Lead budget',
    },
  ],
};

const firstDecision: ReviewerDecision = {
  table: {
    action: 'accept_new',
    name: 'leads',
    description: 'Inbound leads',
    aliases: ['prospect'],
    rationale: 'Distinct sales lead',
  },
  fields: [
    {
      action: 'accept_new',
      fieldKey: 'clinic_count',
      columnName: 'locations_count',
      type: 'integer',
      rationale: 'Generic site count',
    },
    {
      action: 'accept_new',
      fieldKey: 'budget',
      columnName: 'budget',
      type: 'integer',
      rationale: 'Durable sales fact',
    },
  ],
};

const existingSchema: SchemaSnapshot = {
  tables: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'leads',
      aliases: ['prospect'],
      columns: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'locations_count',
          type: 'integer',
          aliases: ['clinics_count', 'three clinics'],
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

function sequentialIds(prefix: number): () => string {
  let value = 0;
  return () => {
    value += 1;
    return `00000000-0000-4000-8000-${String(prefix).padStart(4, '0')}${String(value).padStart(8, '0')}`;
  };
}

describe('calculateIngestionPlan', () => {
  it('creates a canonical schema and stores values by stable column ID', () => {
    const plan = calculateIngestionPlan({
      email,
      schema: { tables: [] },
      proposal: firstProposal,
      decision: firstDecision,
      generateId: sequentialIds(10),
    });

    expect(plan.table.name).toBe('leads');
    expect(plan.columns.map((column) => column.name)).toEqual(['locations_count', 'budget']);
    expect(Object.values(plan.record.data)).toEqual([3, 6500]);
    expect(
      Object.values(plan.record.evidence)
        .flat()
        .map((item) => item.text),
    ).toEqual(['three clinics', 'budget of 6500']);
    expect(plan.events.map((event) => event.eventType)).toEqual([
      'table_proposed',
      'table_accepted',
      'column_proposed',
      'column_accepted',
      'column_proposed',
      'column_accepted',
      'record_created',
    ]);
    expect(plan.schemaRevision).toBe(7);
  });

  it('folds depot wording into the existing locations_count column', () => {
    const depotEmail = normalizeEmail({
      workspaceId: 'demo',
      body: 'Northgate Logistics runs six depots.',
    });
    const plan = calculateIngestionPlan({
      email: depotEmail,
      schema: existingSchema,
      proposal: {
        table: {
          kind: 'existing',
          tableId: '00000000-0000-4000-8000-000000000001',
        },
        fields: [
          {
            key: 'depot_count',
            columnName: 'depots_count',
            type: 'integer',
            value: 6,
            evidence: { source: 'body', text: 'six depots' },
            rationale: 'Site count',
          },
        ],
      },
      decision: {
        table: {
          action: 'use_existing',
          tableId: '00000000-0000-4000-8000-000000000001',
          rationale: 'Another lead',
        },
        fields: [
          {
            action: 'accept_new',
            fieldKey: 'depot_count',
            columnName: 'depots_count',
            type: 'integer',
            rationale: 'Reviewer missed the semantic match',
          },
        ],
      },
      currentSchemaRevision: 7,
    });

    const locationsId = '00000000-0000-4000-8000-000000000002';
    expect(plan.record.data[locationsId]).toBe(6);
    expect(plan.columns).toHaveLength(1);
    expect(plan.columns[0]?.isNew).toBe(false);
    expect(plan.columns[0]?.aliases).toContain('depots_count');
    expect(plan.events.map((event) => event.eventType)).toEqual([
      'column_merged',
      'record_created',
    ]);
    expect(plan.schemaRevision).toBe(9);
  });

  it('rejects evidence that is absent from the source email', () => {
    const plan = calculateIngestionPlan({
      email,
      schema: { tables: [] },
      proposal: {
        ...firstProposal,
        fields: [
          {
            key: 'invalid',
            columnName: 'employees',
            type: 'integer',
            value: 40,
            evidence: { source: 'body', text: 'not present' },
            rationale: 'Bad evidence',
          },
        ],
      },
      decision: {
        table: firstDecision.table,
        fields: [
          {
            action: 'accept_new',
            fieldKey: 'invalid',
            columnName: 'employees_count',
            type: 'integer',
            rationale: 'Otherwise valid',
          },
        ],
      },
    });

    expect(plan.record.data).toEqual({});
    expect(plan.rejectedFields[0]?.reason).toContain('evidence');
    expect(plan.events.map((event) => event.eventType)).toEqual([
      'table_proposed',
      'table_accepted',
      'column_rejected',
      'record_created',
    ]);
  });

  it('requires every architect field to be reviewed', () => {
    expect(() =>
      calculateIngestionPlan({
        email,
        schema: { tables: [] },
        proposal: firstProposal,
        decision: {
          table: firstDecision.table,
          fields: [firstDecision.fields[0]!],
        },
      }),
    ).toThrow('Reviewer did not review architect field budget');
  });

  it('stops ingestion when the reviewer rejects the table', () => {
    expect(() =>
      calculateIngestionPlan({
        email,
        schema: { tables: [] },
        proposal: firstProposal,
        decision: {
          table: { action: 'reject', rationale: 'Not a business record' },
          fields: [],
        },
      }),
    ).toThrow(ReviewerRejectionError);
  });
});
