import { describe, expect, it } from 'vitest';
import type { SchemaSnapshot } from '@formless/core';
import { QUERY_PLANNER_SYSTEM_PROMPT, buildQueryPlannerPrompt } from './query-planner-prompt.js';

const schema: SchemaSnapshot = {
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
          aliases: ['clinics', 'depots'],
          unit: 'sites',
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

describe('buildQueryPlannerPrompt', () => {
  it('places the question, catalogue, and optional selected table in the user content', () => {
    const prompt = buildQueryPlannerPrompt({
      question: 'Which leads have a budget over 5000?',
      schema,
      tableId: '00000000-0000-4000-8000-000000000001',
    });

    expect(prompt.systemPrompt).toBe(QUERY_PLANNER_SYSTEM_PROMPT);
    expect(prompt.systemPrompt).toContain('never write SQL');

    const payload = JSON.parse(prompt.userContent) as {
      question: string;
      selectedTableId?: string;
      catalogue: SchemaSnapshot;
    };
    expect(payload.question).toBe('Which leads have a budget over 5000?');
    expect(payload.selectedTableId).toBe('00000000-0000-4000-8000-000000000001');
    expect(payload.catalogue.tables[0]?.columns[1]?.name).toBe('budget');
    expect(payload.catalogue.tables[0]?.columns[0]?.aliases).toEqual(['clinics', 'depots']);
  });

  it('omits the selected table key when the caller did not choose one', () => {
    const prompt = buildQueryPlannerPrompt({
      question: 'How many depots do we know about?',
      schema,
    });

    const payload = JSON.parse(prompt.userContent) as { selectedTableId?: string };
    expect('selectedTableId' in payload).toBe(false);
  });
});
