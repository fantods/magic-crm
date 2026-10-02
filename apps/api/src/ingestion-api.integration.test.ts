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
import type { ArchitectProposal, ReviewerDecision } from '@formless/core';
import type { EmailIngestionInput, IngestEmailResponse } from '@formless/contracts';
import { FormlessDatabase, runMigrations } from '@formless/database';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { ApiModels } from './models.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const testTimeout = 20_000;

/**
 * Per-test schema IDs. The demo fixtures ship with fixed IDs, but
 * `record_tables.id` is a global primary key, so every test mints its own IDs
 * and rewrites the fixture references to match, keeping runs isolated without
 * any database cleanup.
 */
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

/** ID references in the demo reviewer fixtures must point at this run's IDs. */
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

function demoIdSequence(
  ids: DemoSchemaIds,
  order: (keyof DemoSchemaIds)[] = [
    'leadsTableId',
    'locationsColumnId',
    'budgetColumnId',
    'supportTableId',
    'errorCodeColumnId',
    'blockedColumnId',
  ],
): () => string {
  const queue = order.map((key) => ids[key]);
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
  return `m5-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function stripWorkspace(email: EmailIngestionInput): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...email };
  delete rest.workspaceId;
  return rest;
}

// The architect fixtures carry no cross-test IDs; clone only to stay safe.
function freshArchitectFixtures(): Record<string, ArchitectProposal> {
  return structuredClone(demoArchitectFixtures);
}

describe.skipIf(!databaseUrl)('Ingestion API (PostgreSQL-backed)', () => {
  const database = new FormlessDatabase({
    connectionString: databaseUrl,
    max: 10,
    applicationName: 'magic-crm-m5-tests',
  });

  beforeAll(async () => {
    await runMigrations(database.pool);
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  });

  /**
   * Builds an app wired to the deterministic fake models with fresh IDs. The
   * optional `idOrder` sets the order IDs are minted in, for tests that only
   * ingest part of the demo sequence.
   */
  async function buildDemoApp(
    idOrder?: (keyof DemoSchemaIds)[],
  ): Promise<{ app: FastifyInstance; ids: DemoSchemaIds }> {
    const ids = makeDemoSchemaIds();
    const reviewerFixtures = structuredClone(demoReviewerFixtures);
    rewriteFixtureIds(reviewerFixtures, ids);
    const models: ApiModels = {
      architect: new FakeArchitectModel(freshArchitectFixtures()),
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
    const app = await buildApp({
      database,
      models,
      generateId: demoIdSequence(ids, idOrder),
    });
    return { app, ids };
  }

  async function postEmail(
    app: FastifyInstance,
    workspaceId: string,
    email: EmailIngestionInput,
  ): Promise<{ statusCode: number; body: IngestEmailResponse & { message?: string } }> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ingestions`,
      payload: stripWorkspace(email),
    });
    return { statusCode: response.statusCode, body: response.json() };
  }

  async function countRows(sql: string, values: unknown[]): Promise<number> {
    const result = await database.pool.query<{ total: string }>(sql, values);
    return Number(result.rows[0]!.total);
  }

  it(
    'ingests an email into schema events, projection, and record in one transaction',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app, ids } = await buildDemoApp();

      try {
        const { statusCode, body } = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(statusCode).toBe(201);
        expect(body.ingestion.status).toBe('completed');
        expect(body.ingestion.workspaceId).toBe(workspaceId);

        expect(body.schemaDelta.tableCreated).toBe(true);
        expect(body.schemaDelta.table.id).toBe(ids.leadsTableId);
        expect(body.schemaDelta.table.name).toBe('leads');
        expect(body.schemaDelta.newColumns.map((column: { name: string }) => column.name)).toEqual([
          'locations_count',
          'budget',
        ]);
        expect(body.schemaDelta.mergedColumns).toEqual([]);
        expect(body.record.data).toEqual({
          [ids.locationsColumnId]: 3,
          [ids.budgetColumnId]: 6500,
        });
        expect(body.record.evidence[ids.locationsColumnId]?.[0]?.text).toBe('three clinics');
        expect(body.schemaDelta.schemaRevision).toBe(7);

        expect(
          await countRows('SELECT COUNT(*) AS total FROM ingestions WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
        expect(
          await countRows(
            'SELECT COUNT(*) AS total FROM schema_events WHERE workspace_id = $1 AND ingestion_id = $2',
            [workspaceId, body.ingestion.id],
          ),
        ).toBe(7);

        const fetched = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/ingestions/${body.ingestion.id}`,
        });
        expect(fetched.statusCode).toBe(200);
        const fetchedBody = fetched.json();
        expect(fetchedBody.ingestion.status).toBe('completed');
        expect(fetchedBody.ingestion.result.record.id).toBe(body.record.id);
        expect(fetchedBody.ingestion.result.schemaDelta.table.id).toBe(ids.leadsTableId);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'replays the same email to one ingestion and one record',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app } = await buildDemoApp();

      try {
        const first = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(first.statusCode).toBe(201);
        const replay = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(replay.statusCode).toBe(200);
        expect(replay.body.ingestion.id).toBe(first.body.ingestion.id);
        expect(replay.body.record.id).toBe(first.body.record.id);
        expect(replay.body.schemaDelta.tableCreated).toBe(true);
        expect(replay.body.record.data).toEqual(first.body.record.data);

        expect(
          await countRows('SELECT COUNT(*) AS total FROM ingestions WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM schema_events WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(7);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'honors explicit idempotency keys',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app } = await buildDemoApp();

      try {
        const payload = {
          ...stripWorkspace(supportTicketEmail),
          idempotencyKey: `m5-key-${randomUUID()}`,
        };
        const first = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${workspaceId}/ingestions`,
          payload,
        });
        expect(first.statusCode).toBe(201);
        const replay = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${workspaceId}/ingestions`,
          payload,
        });
        expect(replay.statusCode).toBe(200);
        const firstBody = first.json();
        const replayBody = replay.json();
        expect(replayBody.ingestion.id).toBe(firstBody.ingestion.id);
        expect(replayBody.record.id).toBe(firstBody.record.id);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM ingestions WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(1);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'folds synonym counts into one locations_count column across the demo sequence',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app, ids } = await buildDemoApp();

      try {
        const clinic = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(clinic.statusCode).toBe(201);
        const depot = await postEmail(app, workspaceId, depotLeadEmail);
        expect(depot.statusCode).toBe(201);
        expect(depot.body.schemaDelta.tableCreated).toBe(false);
        expect(depot.body.schemaDelta.newColumns).toEqual([]);
        expect(
          depot.body.schemaDelta.mergedColumns.map((column: { name: string }) => column.name),
        ).toEqual(['locations_count']);
        const centre = await postEmail(app, workspaceId, distributionCentreLeadEmail);
        expect(centre.statusCode).toBe(201);

        expect(depot.body.record.data).toEqual({ [ids.locationsColumnId]: 6 });
        expect(centre.body.record.data).toEqual({ [ids.locationsColumnId]: 18 });
        expect(depot.body.record.tableId).toBe(clinic.body.record.tableId);
        expect(centre.body.record.tableId).toBe(clinic.body.record.tableId);

        const columns = await database.pool.query<{ name: string; aliases: string[] }>(
          'SELECT name, aliases FROM record_columns WHERE workspace_id = $1 AND table_id = $2 ORDER BY name',
          [workspaceId, ids.leadsTableId],
        );
        expect(columns.rows).toHaveLength(2);
        const locations = columns.rows.find((row) => row.name === 'locations_count')!;
        expect(locations.aliases).toEqual(
          expect.arrayContaining(['clinics_count', 'depots_count', 'distribution_centres_count']),
        );

        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(3);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM schema_events WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(11);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'creates a separate logical table for support tickets',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app, ids } = await buildDemoApp([
        'supportTableId',
        'errorCodeColumnId',
        'blockedColumnId',
      ]);

      try {
        const { statusCode, body } = await postEmail(app, workspaceId, supportTicketEmail);
        expect(statusCode).toBe(201);
        expect(body.schemaDelta.tableCreated).toBe(true);
        expect(body.schemaDelta.table.id).toBe(ids.supportTableId);
        expect(body.schemaDelta.table.name).toBe('support_tickets');
        expect(body.schemaDelta.newColumns.map((column: { name: string }) => column.name)).toEqual([
          'error_code',
          'blocks_weekly_review',
        ]);
        expect(body.record.data).toEqual({
          [ids.errorCodeColumnId]: 'CRM-8842',
          [ids.blockedColumnId]: true,
        });
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'returns 422 and records a failed ingestion when the reviewer rejects',
    async () => {
      const workspaceId = newWorkspaceId();
      const rejectionReviewer = new FakeReviewerModel({
        [clinicLeadEmail.body]: {
          table: { action: 'reject', rationale: 'Not CRM content.' },
          fields: [],
        },
      });
      const app = await buildApp({
        database,
        models: {
          architect: new FakeArchitectModel(freshArchitectFixtures()),
          reviewer: rejectionReviewer,
          planner: new FakeQueryPlannerModel({}),
          label: 'fake',
        },
      });

      try {
        const { statusCode, body } = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(statusCode).toBe(422);
        expect(body.message).toContain('Not CRM content.');

        const status = await database.pool.query<{ status: string; error: string }>(
          'SELECT status, error FROM ingestions WHERE workspace_id = $1',
          [workspaceId],
        );
        expect(status.rows).toHaveLength(1);
        expect(status.rows[0]!.status).toBe('failed');
        expect(status.rows[0]!.error).toContain('Not CRM content.');
        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(0);
        expect(
          await countRows('SELECT COUNT(*) AS total FROM schema_events WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(0);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'maps unreachable model endpoints to 502 and records the failure',
    async () => {
      const workspaceId = newWorkspaceId();
      const app = await buildApp({
        database,
        env: { OPENAI_API_KEY: 'unused-by-tests', OPENAI_BASE_URL: 'http://127.0.0.1:9' },
      });

      try {
        const { statusCode, body } = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(statusCode).toBe(502);
        expect(body.message).toContain('Model call failed');

        const status = await database.pool.query<{ status: string; error: string }>(
          'SELECT status, error FROM ingestions WHERE workspace_id = $1',
          [workspaceId],
        );
        expect(status.rows).toHaveLength(1);
        expect(status.rows[0]!.status).toBe('failed');
        expect(status.rows[0]!.error).toContain('OpenAI');
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'exposes the schema journal with pagination',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app } = await buildDemoApp();

      try {
        const clinic = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(clinic.statusCode).toBe(201);

        const all = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/schema/events`,
        });
        expect(all.statusCode).toBe(200);
        const allBody = all.json();
        expect(allBody.total).toBe(7);
        expect(allBody.events).toHaveLength(7);
        expect(allBody.events.map((event: { eventType: string }) => event.eventType)).toEqual([
          'table_proposed',
          'table_accepted',
          'column_proposed',
          'column_accepted',
          'column_proposed',
          'column_accepted',
          'record_created',
        ]);
        expect(allBody.events[0].actor).toEqual({ source: 'ingestion-api', model: 'fake' });

        const page1 = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/schema/events?limit=2&offset=0`,
        });
        expect(page1.json().events).toHaveLength(2);
        expect(page1.json().total).toBe(7);

        const page4 = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceId}/schema/events?limit=2&offset=6`,
        });
        expect(page4.json().events).toHaveLength(1);
        expect(page4.json().events[0].sequence).toBe(7);

        const missing = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${newWorkspaceId()}/schema/events`,
        });
        expect(missing.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'isolates workspaces on every new query path',
    async () => {
      const workspaceA = newWorkspaceId();
      const workspaceB = newWorkspaceId();
      const { app } = await buildDemoApp();

      try {
        const a = await postEmail(app, workspaceA, clinicLeadEmail);
        const b = await postEmail(app, workspaceB, clinicLeadEmail);
        expect(a.statusCode).toBe(201);
        expect(b.statusCode).toBe(201);
        expect(a.body.schemaDelta.table.id).not.toBe(b.body.schemaDelta.table.id);

        const crossWorkspace = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceA}/ingestions/${b.body.ingestion.id}`,
        });
        expect(crossWorkspace.statusCode).toBe(404);

        const ownWorkspace = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceB}/ingestions/${b.body.ingestion.id}`,
        });
        expect(ownWorkspace.statusCode).toBe(200);

        const eventsA = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceA}/schema/events`,
        });
        expect(eventsA.json().total).toBe(7);
        expect(
          eventsA
            .json()
            .events.every((event: { workspaceId: string }) => event.workspaceId === workspaceA),
        ).toBe(true);

        const unknownIngestion = await app.inject({
          method: 'GET',
          url: `/api/v1/workspaces/${workspaceA}/ingestions/${randomUUID()}`,
        });
        expect(unknownIngestion.statusCode).toBe(404);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'serializes concurrent ingests to one logical table via the advisory lock',
    async () => {
      const workspaceId = newWorkspaceId();
      const { app, ids } = await buildDemoApp();

      try {
        const clinic = await postEmail(app, workspaceId, clinicLeadEmail);
        expect(clinic.statusCode).toBe(201);

        const [depot, centre] = await Promise.all([
          postEmail(app, workspaceId, depotLeadEmail),
          postEmail(app, workspaceId, distributionCentreLeadEmail),
        ]);
        expect(depot.statusCode).toBe(201);
        expect(centre.statusCode).toBe(201);
        expect(depot.body.record.id).not.toBe(centre.body.record.id);
        expect(depot.body.record.data).toEqual({ [ids.locationsColumnId]: 6 });
        expect(centre.body.record.data).toEqual({ [ids.locationsColumnId]: 18 });

        expect(
          await countRows('SELECT COUNT(*) AS total FROM records WHERE workspace_id = $1', [
            workspaceId,
          ]),
        ).toBe(3);

        const sequences = await database.pool.query<{ sequence: number }>(
          'SELECT sequence FROM schema_events WHERE workspace_id = $1 ORDER BY sequence',
          [workspaceId],
        );
        const sequenceNumbers = sequences.rows.map((row) => Number(row.sequence));
        expect(sequenceNumbers).toEqual(
          [...Array(sequenceNumbers.length).keys()].map((n) => n + 1),
        );
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );
});
