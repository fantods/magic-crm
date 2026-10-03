import { randomUUID } from 'node:crypto';
import type { ReviewerDecision } from '@formless/core';
import {
  DEMO_BLOCKED_COLUMN_ID,
  DEMO_BUDGET_COLUMN_ID,
  DEMO_ERROR_CODE_COLUMN_ID,
  DEMO_LEADS_TABLE_ID,
  DEMO_LOCATIONS_COLUMN_ID,
  DEMO_SUPPORT_TABLE_ID,
  FakeArchitectModel,
  FakeQueryPlannerModel,
  FakeReviewerModel,
  demoArchitectFixtures,
  demoQueryPlannerFixturesWithDemoIds,
  demoReviewerFixtures,
} from '@formless/testing';
import type { ApiModels } from './models.js';

/**
 * Wiring for `MODEL_MODE=fake`: the deterministic demo models from
 * `@formless/testing` plus the id minting order their fixtures expect. Lets
 * containers and demos run the full ingestion and query pipelines with no
 * OpenAI key and no network.
 */
export interface FakeModelWiring {
  readonly models: ApiModels;
  readonly generateId: () => string;
}

/** Optional label override; defaults to the demo label. */
export interface FakeModelWiringOptions {
  readonly label?: string;
}

/**
 * Per-run schema ids. The demo fixtures ship with fixed ids, but
 * `record_tables.id` is a global primary key, so the run mints fresh ids and
 * rewrites the fixture references to match (same convention as the API
 * integration tests). The planner fixtures then reuse the canonical demo ids,
 * which the minting order below reproduces.
 */
interface DemoSchemaIds {
  leadsTableId: string;
  locationsColumnId: string;
  budgetColumnId: string;
  supportTableId: string;
  errorCodeColumnId: string;
  blockedColumnId: string;
}

function demoSchemaIds(): DemoSchemaIds {
  return {
    leadsTableId: DEMO_LEADS_TABLE_ID,
    locationsColumnId: DEMO_LOCATIONS_COLUMN_ID,
    budgetColumnId: DEMO_BUDGET_COLUMN_ID,
    supportTableId: DEMO_SUPPORT_TABLE_ID,
    errorCodeColumnId: DEMO_ERROR_CODE_COLUMN_ID,
    blockedColumnId: DEMO_BLOCKED_COLUMN_ID,
  };
}

/** Rewrites the reviewer fixtures' cross-references to this run's ids. */
function rewriteFixtureIds(decisions: Record<string, ReviewerDecision>): void {
  const ids = demoSchemaIds();
  for (const decision of Object.values(decisions)) {
    if (decision.table.action === 'use_existing') {
      decision.table.tableId = ids.leadsTableId;
    }
    for (const field of decision.fields) {
      if (field.action === 'map_existing') {
        field.existingColumnId = ids.locationsColumnId;
      }
    }
  }
}

/**
 * Id minting order matching the demo ingestion sequence: the leads table and
 * its two columns first, then the support ticket table and its two columns.
 * Because the minted ids equal the canonical demo ids, the demo query planner
 * fixtures work unchanged.
 */
function demoIdSequence(): () => string {
  const ids = demoSchemaIds();
  const queue: string[] = [
    ids.leadsTableId,
    ids.locationsColumnId,
    ids.budgetColumnId,
    ids.supportTableId,
    ids.errorCodeColumnId,
    ids.blockedColumnId,
  ];
  const minted = new Set<string>();
  return () => {
    const id = queue.find((candidate) => !minted.has(candidate));
    if (id === undefined) {
      return randomUUID();
    }
    minted.add(id);
    return id;
  };
}

/**
 * Builds the deterministic model set for keyless runs. `label` is operational
 * metadata recorded on schema events; it never contains email content.
 */
export function createFakeModelWiring(options: FakeModelWiringOptions = {}): FakeModelWiring {
  rewriteFixtureIds(demoReviewerFixtures);

  return {
    models: {
      architect: new FakeArchitectModel(structuredClone(demoArchitectFixtures)),
      reviewer: new FakeReviewerModel(demoReviewerFixtures),
      planner: new FakeQueryPlannerModel(demoQueryPlannerFixturesWithDemoIds),
      label: options.label ?? 'fake:demo',
    },
    generateId: demoIdSequence(),
  };
}
