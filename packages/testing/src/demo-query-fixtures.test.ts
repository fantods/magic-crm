import { describe, expect, it } from 'vitest';
import { queryPlanOutputSchema } from '@formless/contracts';
import {
  DEMO_BLOCKED_TICKETS_QUESTION,
  DEMO_BUDGET_QUESTION,
  demoQueryPlannerFixturesWithDemoIds,
} from './demo-query-fixtures.js';
import { FakeQueryPlannerModel } from './fake-query-planner.js';

describe('demo query planner fixtures', () => {
  it('satisfy the query plan contract and never carry a workspace', () => {
    for (const [question, plan] of Object.entries(demoQueryPlannerFixturesWithDemoIds)) {
      const parsed = queryPlanOutputSchema.parse(plan);
      expect('workspaceId' in parsed.query).toBe(false);
      expect(question.length).toBeGreaterThan(0);
    }
  });

  it('answer the demo budget question with the demo leads table and budget column', () => {
    const plan = demoQueryPlannerFixturesWithDemoIds[DEMO_BUDGET_QUESTION];

    expect(plan?.query.tableId).toBe('00000000-0000-4000-8000-000000000001');
    expect(plan?.query.filter).toEqual({
      kind: 'comparison',
      columnId: '00000000-0000-4000-8000-000000000003',
      operator: 'gt',
      value: 5000,
    });
  });

  it('answer the blocked tickets question with an equality filter on the boolean column', () => {
    const plan = demoQueryPlannerFixturesWithDemoIds[DEMO_BLOCKED_TICKETS_QUESTION];

    expect(plan?.query.tableId).toBe('00000000-0000-4000-8000-000000000004');
    expect(plan?.query.filter).toEqual({
      kind: 'comparison',
      columnId: '00000000-0000-4000-8000-000000000006',
      operator: 'eq',
      value: true,
    });
  });

  it('serve the fake planner deterministically and reject unknown questions', async () => {
    const planner = new FakeQueryPlannerModel(demoQueryPlannerFixturesWithDemoIds);

    const plan = await planner.plan({
      question: DEMO_BUDGET_QUESTION,
      schema: { tables: [] },
    });
    expect(plan.query.tableId).toBe('00000000-0000-4000-8000-000000000001');

    await expect(
      planner.plan({ question: 'What is the meaning of life?', schema: { tables: [] } }),
    ).rejects.toThrow(/No fake query planner fixture/);
  });
});
