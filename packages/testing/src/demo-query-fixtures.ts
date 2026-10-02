import type { QueryPlanOutput } from '@formless/contracts';
import {
  DEMO_BLOCKED_COLUMN_ID,
  DEMO_BUDGET_COLUMN_ID,
  DEMO_LEADS_TABLE_ID,
  DEMO_SUPPORT_TABLE_ID,
} from './demo-model-fixtures.js';

/** The demo question from PLAN.md's acceptance criteria. */
export const DEMO_BUDGET_QUESTION = 'Which leads have a budget over 5000?';
export const DEMO_BLOCKED_TICKETS_QUESTION = 'Which support tickets are blocked?';

/** Table and column ids a demo planner fixture must reference. */
export interface DemoQuerySchemaIds {
  readonly leadsTableId: string;
  readonly budgetColumnId: string;
  readonly supportTableId: string;
  readonly blockedColumnId: string;
}

/**
 * Builds the demo query planner fixtures for the given run's schema ids. The
 * planner emits structured queries only (never SQL); the server injects the
 * workspace, so the fixtures carry no workspace.
 */
export function demoQueryPlannerFixtures(ids: DemoQuerySchemaIds): Record<string, QueryPlanOutput> {
  return {
    [DEMO_BUDGET_QUESTION]: {
      query: {
        tableId: ids.leadsTableId,
        filter: {
          kind: 'comparison',
          columnId: ids.budgetColumnId,
          operator: 'gt',
          value: 5000,
        },
        orderBy: {
          columnId: ids.budgetColumnId,
          direction: 'desc',
        },
      },
      interpretation:
        'Records in the "leads" table whose budget column value is greater than 5000, highest budget first.',
      warnings: [],
    },
    [DEMO_BLOCKED_TICKETS_QUESTION]: {
      query: {
        tableId: ids.supportTableId,
        filter: {
          kind: 'comparison',
          columnId: ids.blockedColumnId,
          operator: 'eq',
          value: true,
        },
      },
      interpretation:
        'Records in the "support_tickets" table whose blocks_weekly_review column is true.',
      warnings: [],
    },
  };
}

/** Demo fixtures keyed to the canonical demo ids (for pure unit tests). */
export const demoQueryPlannerFixturesWithDemoIds: Record<string, QueryPlanOutput> =
  demoQueryPlannerFixtures({
    leadsTableId: DEMO_LEADS_TABLE_ID,
    budgetColumnId: DEMO_BUDGET_COLUMN_ID,
    supportTableId: DEMO_SUPPORT_TABLE_ID,
    blockedColumnId: DEMO_BLOCKED_COLUMN_ID,
  });
