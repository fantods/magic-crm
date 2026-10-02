import { describe, expect, it } from 'vitest';
import { architectProposalSchema, reviewerDecisionSchema } from '@formless/core';
import { normalizeModelOutput } from './normalize-output.js';

const clinicProposalWire = {
  table: {
    kind: 'new',
    name: 'Lead',
    description: null,
    aliases: ['prospect'],
  },
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
  ],
  extra_key: 'stripped by the zod parse',
};

describe('normalizeModelOutput', () => {
  it('drops nulls at optional-but-not-nullable positions', () => {
    const normalized = normalizeModelOutput(architectProposalSchema, clinicProposalWire) as Record<
      string,
      unknown
    >;

    const table = normalized.table as Record<string, unknown>;
    expect('description' in table).toBe(false);
    const field = (normalized.fields as Record<string, unknown>[])[0]!;
    expect('enumValues' in field).toBe(false);
    const evidence = field.evidence as Record<string, unknown>;
    expect('startIndex' in evidence).toBe(false);
    expect('endIndex' in evidence).toBe(false);
  });

  it('keeps legitimate null values under unknown-typed fields', () => {
    const normalized = normalizeModelOutput(architectProposalSchema, {
      ...clinicProposalWire,
      fields: [
        {
          ...(clinicProposalWire.fields[0] as object),
          value: null,
        },
      ],
    }) as Record<string, unknown>;
    const field = (normalized.fields as Record<string, unknown>[])[0]!;
    expect(field.value).toBeNull();
  });

  it('parses against the domain contract after normalization', () => {
    const proposal = architectProposalSchema.parse(
      normalizeModelOutput(architectProposalSchema, clinicProposalWire),
    );
    expect(proposal.table).toEqual({
      kind: 'new',
      name: 'Lead',
      aliases: ['prospect'],
    });
    expect(proposal.fields[0]?.evidence).toEqual({ source: 'body', text: 'three clinics' });
  });

  it('normalizes discriminated union variants by their discriminator', () => {
    const existing = normalizeModelOutput(architectProposalSchema, {
      ...clinicProposalWire,
      table: { kind: 'existing', tableId: '00000000-0000-4000-8000-000000000001' },
    }) as Record<string, unknown>;
    expect(existing.table).toEqual({
      kind: 'existing',
      tableId: '00000000-0000-4000-8000-000000000001',
    });
  });

  it('normalizes reviewer decisions with union variants', () => {
    const decisionWire = {
      table: {
        action: 'accept_new',
        name: 'leads',
        description: null,
        aliases: ['prospect'],
        rationale: 'A distinct sales lead.',
      },
      fields: [
        {
          action: 'accept_new',
          fieldKey: 'clinic_count',
          columnName: 'locations_count',
          type: 'integer',
          enumValues: null,
          rationale: 'Generic durable name for site counts.',
        },
        {
          action: 'map_existing',
          fieldKey: 'budget',
          existingColumnId: '00000000-0000-4000-8000-000000000003',
          rationale: 'Budget already exists.',
        },
      ],
    };

    const decision = reviewerDecisionSchema.parse(
      normalizeModelOutput(reviewerDecisionSchema, decisionWire),
    );
    expect(decision.table).toEqual({
      action: 'accept_new',
      name: 'leads',
      aliases: ['prospect'],
      rationale: 'A distinct sales lead.',
    });
    expect(decision.fields[0]).toEqual({
      action: 'accept_new',
      fieldKey: 'clinic_count',
      columnName: 'locations_count',
      type: 'integer',
      rationale: 'Generic durable name for site counts.',
    });
    expect(decision.fields[1]).toEqual({
      action: 'map_existing',
      fieldKey: 'budget',
      existingColumnId: '00000000-0000-4000-8000-000000000003',
      rationale: 'Budget already exists.',
    });
  });

  it('leaves unmatched union values untouched for the authoritative parse', () => {
    const bogus = { table: { kind: 'mystery' }, fields: [] };
    expect(normalizeModelOutput(architectProposalSchema, bogus)).toEqual(bogus);
  });
});
