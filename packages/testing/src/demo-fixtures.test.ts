import { describe, expect, it } from 'vitest';
import { IngestionPlanner } from '@formless/core';
import { emptySchema } from '@formless/core';
import {
  DEMO_BUDGET_COLUMN_ID,
  DEMO_LEADS_TABLE_ID,
  DEMO_LOCATIONS_COLUMN_ID,
  depotLeadEmail,
  distributionCentreLeadEmail,
  clinicLeadEmail,
  supportTicketEmail,
  demoArchitectFixtures,
  demoReviewerFixtures,
  FakeArchitectModel,
  FakeReviewerModel,
} from './index.js';

describe('demo model fixtures', () => {
  it('are network-free and produce a deterministic first ingestion plan', async () => {
    const planner = new IngestionPlanner(
      new FakeArchitectModel(demoArchitectFixtures),
      new FakeReviewerModel(demoReviewerFixtures),
      fixedDemoIds(),
    );
    const planned = await planner.plan(clinicLeadEmail, emptySchema, 0);

    expect(planned.plan.table.name).toBe('leads');
    expect(planned.plan.columns.map((column) => column.name)).toEqual([
      'locations_count',
      'budget',
    ]);
    expect(Object.values(planned.plan.record.data)).toEqual([3, 6500]);
    expect(planned.email.idempotencyKey).toHaveLength(70);
  });
});

function fixedDemoIds(): () => string {
  const ids = [DEMO_LEADS_TABLE_ID, DEMO_LOCATIONS_COLUMN_ID, DEMO_BUDGET_COLUMN_ID];
  let value = 0;
  return () => {
    const id = ids[value];
    value += 1;
    if (!id) {
      throw new Error('Unexpected additional ID request');
    }
    return id;
  };
}

describe('Magic CRM demo sequence', () => {
  it('folds three industry terms into one locations_count column', async () => {
    const architect = new FakeArchitectModel(demoArchitectFixtures);
    const reviewer = new FakeReviewerModel(demoReviewerFixtures);
    const planner = new IngestionPlanner(architect, reviewer, fixedDemoIds());
    const first = await planner.plan(clinicLeadEmail, emptySchema, 0);
    const schema = {
      tables: [
        {
          ...first.plan.table,
          aliases: [...first.plan.table.aliases],
          columns: first.plan.columns.map((column) => ({
            ...column,
            aliases: [...column.aliases],
          })),
        },
      ],
    };

    const depot = await planner.plan(depotLeadEmail, schema, first.plan.schemaRevision);
    const distribution = await planner.plan(
      distributionCentreLeadEmail,
      schema,
      depot.plan.schemaRevision,
    );

    expect(first.plan.record.data[DEMO_LOCATIONS_COLUMN_ID]).toBe(3);
    expect(depot.plan.record.data[DEMO_LOCATIONS_COLUMN_ID]).toBe(6);
    expect(distribution.plan.record.data[DEMO_LOCATIONS_COLUMN_ID]).toBe(18);
    expect(depot.plan.columns[0]?.name).toBe('locations_count');
    expect(depot.plan.columns[0]?.aliases).toContain('depots_count');
    expect(distribution.plan.columns[0]?.aliases).toContain('distribution_centres_count');
  });

  it('creates a separate support ticket table', async () => {
    const planner = new IngestionPlanner(
      new FakeArchitectModel(demoArchitectFixtures),
      new FakeReviewerModel(demoReviewerFixtures),
      fixedDemoIds(),
    );
    const planned = await planner.plan(supportTicketEmail, emptySchema, 0);

    expect(planned.plan.table.name).toBe('support_tickets');
    expect(planned.plan.columns.map((column) => column.name)).toEqual([
      'error_code',
      'blocks_weekly_review',
    ]);
  });
});
