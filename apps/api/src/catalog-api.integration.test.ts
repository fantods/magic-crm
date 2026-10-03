import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FakeArchitectModel,
  FakeQueryPlannerModel,
  FakeReviewerModel,
  clinicLeadEmail,
  demoArchitectFixtures,
  demoQueryPlannerFixtures,
  demoReviewerFixtures,
  depotLeadEmail,
  distributionCentreLeadEmail,
  supportTicketEmail,
} from '@formless/testing';
import type { ReviewerDecision } from '@formless/core';
import type { RecordsResponse, SchemaCatalogResponse } from '@formless/contracts';
import { FormlessDatabase, runMigrations } from '@formless/database';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { ApiModels } from './models.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const testTimeout = 20_000;

interface DemoSchemaIds {
  leadsTableId: string;
  locationsColumnId: string;
  budgetColumnId: string;
  supportTableId: string;
  errorCodeColumnId: string;
  blockedColumnId: string;
}

function makeDemoSchemaIds(): DemoSchemaIds {
  return {
    leadsTableId: randomUUID(),
    locationsColumnId: randomUUID(),
    budgetColumnId: randomUUID(),
    supportTableId: randomUUID(),
    errorCodeColumnId: randomUUID(),
    blockedColumnId: randomUUID(),
  };
}

function rewriteFixtureIds(decisions: Record<string, ReviewerDecision>, ids: DemoSchemaIds) {
  for (const body of [depotLeadEmail.body, distributionCentreLeadEmail.body]) {
    const decision = decisions[body]!;
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

function demoIdSequence(ids: DemoSchemaIds): () => string {
  const queue: string[] = [
    ids.leadsTableId,
    ids.locationsColumnId,
    ids.budgetColumnId,
    ids.supportTableId,
    ids.errorCodeColumnId,
    ids.blockedColumnId,
  ];
  let next = 0;
  return () => {
    const id = queue[next];
    next += 1;
    if (!id) {
      throw new Error('Unexpected additional ID request');
    }
    return id;
  };
}

function newWorkspaceId(): string {
  return `m7-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

async function ingestAllDemoEmails(app: FastifyInstance, workspaceId: string): Promise<void> {
  for (const email of [
    clinicLeadEmail,
    depotLeadEmail,
    distributionCentreLeadEmail,
    supportTicketEmail,
  ]) {
    const { workspaceId: _ignored, ...body } = email;
    void _ignored;
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ingestions`,
      payload: body,
    });
    expect(response.statusCode).toBe(201);
  }
}

describe.skipIf(!databaseUrl)('Schema catalog and records API (PostgreSQL-backed)', () => {
  const database = new FormlessDatabase({
    connectionString: databaseUrl,
    max: 10,
    applicationName: 'magic-crm-m7-tests',
  });

  beforeAll(async () => {
    await runMigrations(database.pool);
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  });

  async function buildDemoApp(ids: DemoSchemaIds): Promise<FastifyInstance> {
    const reviewerFixtures = structuredClone(demoReviewerFixtures);
    rewriteFixtureIds(reviewerFixtures, ids);
    const models: ApiModels = {
      architect: new FakeArchitectModel(structuredClone(demoArchitectFixtures)),
      reviewer: new FakeReviewerModel(reviewerFixtures),
      planner: new FakeQueryPlannerModel(
        demoQueryPlannerFixtures({
          leadsTableId: ids.leadsTableId,
          budgetColumnId: ids.budgetColumnId,
          supportTableId: ids.supportTableId,
          blockedColumnId: ids.blockedColumnId,
        }),
      ),
      label: 'fake',
    };
    return buildApp({ database, models, generateId: demoIdSequence(ids) });
  }

  it('serves the schema catalogue with tables, columns, and the schema revision', async () => {
    const ids = makeDemoSchemaIds();
    const app = await buildDemoApp(ids);
    const workspaceId = newWorkspaceId();
    await ingestAllDemoEmails(app, workspaceId);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/schema`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as SchemaCatalogResponse;
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.revision).toBeGreaterThan(0);

    const tableNames = body.tables.map(({ table }) => table.name);
    expect(tableNames).toEqual(['leads', 'support_tickets']);

    const leads = body.tables.find(({ table }) => table.id === ids.leadsTableId);
    expect(leads?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['locations_count', 'budget']),
    );
    expect(leads?.columns).toHaveLength(2);
    const locations = leads?.columns.find((column) => column.id === ids.locationsColumnId);
    expect(locations?.type).toBe('integer');
    // Aliases accumulate from every merged synonym, canonicalized.
    expect(locations?.aliases).toEqual(
      expect.arrayContaining(['clinics_count', 'depots_count', 'three_clinics', 'six_depots']),
    );

    const support = body.tables.find(({ table }) => table.id === ids.supportTableId);
    expect(support?.columns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['blocks_weekly_review', 'error_code']),
    );
    expect(support?.columns).toHaveLength(2);

    await app.close();
  });

  it('answers 404 for the catalogue of an unknown workspace', async () => {
    const app = await buildDemoApp(makeDemoSchemaIds());
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${newWorkspaceId()}/schema`,
    });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('serves the records of one table with canonical values and evidence', async () => {
    const ids = makeDemoSchemaIds();
    const app = await buildDemoApp(ids);
    const workspaceId = newWorkspaceId();
    await ingestAllDemoEmails(app, workspaceId);

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/tables/${ids.leadsTableId}/records`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as RecordsResponse;
    expect(body.records).toHaveLength(3);
    // Record data and evidence are keyed by internal column ids.
    expect(body.records.map((record) => record.data[ids.locationsColumnId])).toEqual([18, 6, 3]);
    for (const record of body.records) {
      const evidence = record.evidence[ids.locationsColumnId];
      expect(evidence?.[0]?.text).toMatch(/clinics|depots|distribution centres/);
    }

    await app.close();
  });

  it('answers 404 for records of an unknown table and validates the limit parameter', async () => {
    const ids = makeDemoSchemaIds();
    const app = await buildDemoApp(ids);
    const workspaceId = newWorkspaceId();
    await ingestAllDemoEmails(app, workspaceId);

    const missingTable = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/tables/${randomUUID()}/records`,
    });
    expect(missingTable.statusCode).toBe(404);

    const badLimit = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/tables/${ids.leadsTableId}/records?limit=0`,
    });
    expect(badLimit.statusCode).toBe(400);

    const hugeLimit = await app.inject({
      method: 'GET',
      url: `/api/v1/workspaces/${workspaceId}/tables/${ids.leadsTableId}/records?limit=201`,
    });
    expect(hugeLimit.statusCode).toBe(400);

    await app.close();
  });
});
