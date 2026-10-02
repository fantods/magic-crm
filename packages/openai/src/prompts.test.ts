import { describe, expect, it } from 'vitest';
import { normalizeEmail } from '@formless/core';
import { buildArchitectPrompt } from './architect-prompt.js';
import { buildReviewerPrompt } from './reviewer-prompt.js';

const email = normalizeEmail({
  workspaceId: 'demo',
  subject: 'Meridian Health expansion lead',
  body: 'Meridian Health operates three clinics across Ontario and has a budget of 6500.',
  from: 'ops@meridianhealth.example',
  to: 'sales@magiccrm.example',
});

const schema = {
  tables: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'leads',
      aliases: ['prospect'],
      columns: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'locations_count',
          type: 'integer' as const,
          aliases: ['clinics', 'depots'],
          unit: 'sites',
        },
      ],
    },
  ],
};

const proposal = {
  table: {
    kind: 'existing' as const,
    tableId: '00000000-0000-4000-8000-000000000001',
  },
  fields: [
    {
      key: 'clinic_count',
      columnName: 'clinics_count',
      type: 'integer' as const,
      value: 3,
      evidence: { source: 'body' as const, text: 'three clinics' },
      rationale: 'The sender states the number of operated clinics.',
    },
  ],
};

describe('buildArchitectPrompt', () => {
  it('serializes the email and schema into the user payload', () => {
    const prompt = buildArchitectPrompt({ email, schema });
    const payload = JSON.parse(prompt.userContent) as {
      email: Record<string, unknown>;
      currentSchema: { tables: unknown[] };
    };

    expect(prompt.systemPrompt).toContain('schema architect');
    expect(prompt.systemPrompt).toContain('conservative canonical type');
    expect(payload.email.body).toBe(email.body);
    expect(payload.email.subject).toBe('Meridian Health expansion lead');
    expect(payload.currentSchema.tables[0]).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      name: 'leads',
      aliases: ['prospect'],
      columns: [
        {
          id: '00000000-0000-4000-8000-000000000002',
          name: 'locations_count',
          type: 'integer',
          aliases: ['clinics', 'depots'],
          unit: 'sites',
        },
      ],
    });
  });

  it('omits absent email metadata and empty aliases', () => {
    const bareEmail = normalizeEmail({
      workspaceId: 'demo',
      body: 'Just a body.',
    });
    const prompt = buildArchitectPrompt({ email: bareEmail, schema: { tables: [] } });
    const payload = JSON.parse(prompt.userContent) as { email: Record<string, unknown> };

    expect(Object.keys(payload.email)).toEqual(['body']);
  });
});

describe('buildReviewerPrompt', () => {
  it('includes the email, schema, and complete architect proposal', () => {
    const prompt = buildReviewerPrompt({ email, schema, proposal });
    const payload = JSON.parse(prompt.userContent) as {
      architectProposal: unknown;
      currentSchema: { tables: unknown[] };
    };

    expect(prompt.systemPrompt).toContain('gatekeeper');
    expect(prompt.systemPrompt).toContain('locations_count');
    expect(payload.architectProposal).toEqual(proposal);
    expect(payload.currentSchema.tables).toHaveLength(1);
  });

  it('appends workspace policy rules and precedent examples to the system prompt', () => {
    const prompt = buildReviewerPrompt(
      { email, schema, proposal },
      {
        rules: ['Never accept a column named notes.'],
        examples: ['clinics_count was renamed to locations_count in ticket 12.'],
      },
    );

    expect(prompt.systemPrompt).toContain('Workspace-specific policy');
    expect(prompt.systemPrompt).toContain('Never accept a column named notes.');
    expect(prompt.systemPrompt).toContain(
      'Precedent: clinics_count was renamed to locations_count in ticket 12.',
    );
  });
});
