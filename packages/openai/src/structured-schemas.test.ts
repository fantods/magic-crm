import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import { architectProposalSchema, reviewerDecisionSchema } from '@formless/core';
import { sourceEvidenceSchema } from '@formless/contracts';
import {
  architectProposalJsonSchema,
  assertStrictModeCompliant,
  reviewerDecisionJsonSchema,
} from './structured-schemas.js';

const ajv = new Ajv2020({ strict: false });

const architectProposalWire = {
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
      key: 'tags',
      columnName: 'tags',
      type: 'json',
      value: ['priority', 'expansion'],
      enumValues: null,
      evidence: {
        source: 'subject',
        text: 'expansion lead',
        startIndex: null,
        endIndex: null,
      },
      rationale: 'Tag list attached to the lead.',
    },
  ],
};

const reviewerDecisionWire = {
  table: {
    action: 'accept_new',
    name: 'leads',
    description: 'Inbound sales leads',
    aliases: ['prospect'],
    rationale: 'A distinct sales lead, not a support request.',
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
      rationale: 'Budget column already exists.',
    },
    {
      action: 'reject',
      fieldKey: 'greeting',
      rationale: 'One-off prose.',
    },
  ],
};

function sortedKeys(value: Record<string, unknown>): string[] {
  return Object.keys(value).sort();
}

describe('structured-output schemas', () => {
  it('satisfy the OpenAI strict-mode structural rules', () => {
    expect(() => assertStrictModeCompliant(architectProposalJsonSchema)).not.toThrow();
    expect(() => assertStrictModeCompliant(reviewerDecisionJsonSchema)).not.toThrow();
  });

  it('accept wire-shape fixtures', () => {
    const architectValidate = ajv.compile(architectProposalJsonSchema);
    expect(architectValidate(architectProposalWire)).toBe(true);

    const reviewerValidate = ajv.compile(reviewerDecisionJsonSchema);
    expect(reviewerValidate(reviewerDecisionWire)).toBe(true);
  });

  it('reject invalid wire output', () => {
    const architectValidate = ajv.compile(architectProposalJsonSchema);

    expect(architectValidate({ table: undefined, fields: [] })).toBe(false);
    expect(
      architectValidate({
        ...architectProposalWire,
        fields: [{ ...architectProposalWire.fields[0]!, type: 'varchar' }],
      }),
    ).toBe(false);
    expect(
      architectValidate({
        ...architectProposalWire,
        fields: [{ ...architectProposalWire.fields[0]!, surprise: true }],
      }),
    ).toBe(false);
    const reviewerValidate = ajv.compile(reviewerDecisionJsonSchema);
    expect(reviewerValidate({ ...reviewerDecisionWire, fields: undefined })).toBe(false);
  });

  it('are key-equivalent to the Zod domain contracts', () => {
    expect(sortedKeys(architectProposalJsonSchema.properties!)).toEqual(
      sortedKeys(architectProposalSchema.shape),
    );

    const architectFieldSchema = architectProposalSchema.shape.fields.element;
    expect(sortedKeys(architectProposalJsonSchema.$defs!.architectField!.properties!)).toEqual(
      sortedKeys(architectFieldSchema.shape),
    );

    expect(sortedKeys(architectProposalJsonSchema.$defs!.sourceEvidence!.properties!)).toEqual(
      sortedKeys(sourceEvidenceSchema.shape),
    );

    expect(sortedKeys(reviewerDecisionJsonSchema.properties!)).toEqual(
      sortedKeys(reviewerDecisionSchema.shape),
    );
  });

  it('use the same column type enum as the contracts', () => {
    const wireEnum = [...(architectProposalJsonSchema.$defs!.columnType!.enum as string[])];

    expect(wireEnum.sort()).toEqual([
      'boolean',
      'date',
      'datetime',
      'decimal',
      'email',
      'enum',
      'integer',
      'json',
      'text',
      'url',
    ]);
  });
});
