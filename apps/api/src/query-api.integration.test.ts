import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEMO_BLOCKED_TICKETS_QUESTION,
  DEMO_BUDGET_QUESTION,
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
import type { QueryResponse } from '@formless/contracts';
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
  return `m6-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

function stripWorkspace(email: { workspaceId: string }): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...email };
  delete rest.workspaceId;
  return rest;
}

async function ingestAllDemoEmails(app: FastifyInstance, workspaceId: string): Promise<void> {
  for (const email of [
    clinicLeadEmail,
    depotLeadEmail,
    distributionCentreLeadEmail,
    supportTicketEmail,
  ]) {
    const body = stripWorkspace(email);
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/ingestions`,
      payload: body,
    });
    expect(response.statusCode).toBe(201);
  }
}

describe.skipIf(!databaseUrl)('Query API (PostgreSQL-backed)', () => {
  const database = new FormlessDatabase({
    connectionString: databaseUrl,
    max: 10,
    applicationName: 'magic-crm-m6-tests',
  });

  beforeAll(async () => {
    await runMigrations(database.pool);
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  });

  async function buildDemoApp(options: {
    ids: DemoSchemaIds;
    planner?: FakeQueryPlannerModel;
  }): Promise<FastifyInstance> {
    const { ids } = options;
    const reviewerFixtures = structuredClone(demoReviewerFixtures);
    rewriteFixtureIds(reviewerFixtures, ids);
    const models: ApiModels = {
      architect: new FakeArchitectModel(structuredClone(demoArchitectFixtures)),
      reviewer: new FakeReviewerModel(reviewerFixtures),
      planner:
        options.planner ??
        new FakeQueryPlannerModel(
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

  async function postQuestion(
    app: FastifyInstance,
    workspaceId: string,
    payload: Record<string, unknown>,
  ): Promise<{ statusCode: number; body: QueryResponse & { message?: string } }> {
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/workspaces/${workspaceId}/query`,
      payload,
    });
    return { statusCode: response.statusCode, body: response.json() };
  }

  it(
    'answers the demo budget question with the matching record',
    async () => {
      const ids = makeDemoSchemaIds();
      const app = await buildDemoApp({ ids });
      const workspaceId = newWorkspaceId();

      try {
        await ingestAllDemoEmails(app, workspaceId);

        const { statusCode, body } = await postQuestion(app, workspaceId, {
          question: DEMO_BUDGET_QUESTION,
        });

        expect(statusCode).toBe(200);
        expect(body.query.workspaceId).toBe(workspaceId);
        expect(body.query.tableId).toBe(ids.leadsTableId);
        expect(body.query.filter).toEqual({
          kind: 'comparison',
          columnId: ids.budgetColumnId,
          operator: 'gt',
          value: 5000,
        });
        expect(body.query.limit).toBe(200);
        expect(body.warnings).toEqual([]);
        expect(body.interpretation).toContain('budget');
        // Only the clinic lead carries a budget (6500 > 5000); the depot and
        // distribution centre leads have no budget, and the support ticket is
        // a different table. Record data is keyed by internal column ids.
        expect(body.records).toHaveLength(1);
        expect(body.records[0]?.data).toMatchObject({
          [ids.budgetColumnId]: 6500,
          [ids.locationsColumnId]: 3,
        });
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'answers a question scoped to a selected table',
    async () => {
      const ids = makeDemoSchemaIds();
      const app = await buildDemoApp({ ids });
      const workspaceId = newWorkspaceId();

      try {
        await ingestAllDemoEmails(app, workspaceId);

        const { statusCode, body } = await postQuestion(app, workspaceId, {
          question: DEMO_BLOCKED_TICKETS_QUESTION,
          tableId: ids.supportTableId,
        });

        expect(statusCode).toBe(200);
        expect(body.query.tableId).toBe(ids.supportTableId);
        expect(body.records).toHaveLength(1);
        expect(body.records[0]?.data).toMatchObject({ [ids.blockedColumnId]: true });
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'rejects questions for unknown workspaces and unknown selected tables',
    async () => {
      const ids = makeDemoSchemaIds();
      const app = await buildDemoApp({ ids });
      const workspaceId = newWorkspaceId();

      try {
        await ingestAllDemoEmails(app, workspaceId);

        const unknownWorkspace = await postQuestion(app, newWorkspaceId(), {
          question: DEMO_BUDGET_QUESTION,
        });
        expect(unknownWorkspace.statusCode).toBe(404);
        expect(unknownWorkspace.body.message).toContain('was not found');

        const unknownTable = await postQuestion(app, workspaceId, {
          question: DEMO_BUDGET_QUESTION,
          tableId: randomUUID(),
        });
        expect(unknownTable.statusCode).toBe(404);
        expect(unknownTable.body.message).toContain('was not found');
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'answers 502 when the planner references a column outside the workspace catalog',
    async () => {
      const ids = makeDemoSchemaIds();
      const roguePlanner = new FakeQueryPlannerModel({
        [DEMO_BUDGET_QUESTION]: {
          query: {
            tableId: ids.leadsTableId,
            filter: { kind: 'comparison', columnId: randomUUID(), operator: 'gt', value: 5000 },
          },
          interpretation: 'Invented column.',
          warnings: [],
        },
      });
      const app = await buildDemoApp({ ids, planner: roguePlanner });
      const workspaceId = newWorkspaceId();

      try {
        await ingestAllDemoEmails(app, workspaceId);

        const { statusCode, body } = await postQuestion(app, workspaceId, {
          question: DEMO_BUDGET_QUESTION,
        });

        expect(statusCode).toBe(502);
        expect(body.message).toContain('query contract');
        expect(body.message).toContain('does not exist in table');
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );

  it(
    'answers 502 when the planner selects a table from another workspace',
    async () => {
      // Workspace A ingests first; the planner for workspace B still points at
      // workspace A's table ids, which must never be usable from B.
      const idsA = makeDemoSchemaIds();
      const appA = await buildDemoApp({ ids: idsA });
      const workspaceA = newWorkspaceId();
      const workspaceB = newWorkspaceId();

      try {
        await ingestAllDemoEmails(appA, workspaceA);

        const idsB = makeDemoSchemaIds();
        const foreignPlanner = new FakeQueryPlannerModel(
          demoQueryPlannerFixtures({
            leadsTableId: idsA.leadsTableId,
            budgetColumnId: idsA.budgetColumnId,
            supportTableId: idsA.supportTableId,
            blockedColumnId: idsA.blockedColumnId,
          }),
        );
        const appB = await buildDemoApp({ ids: idsB, planner: foreignPlanner });
        try {
          await ingestAllDemoEmails(appB, workspaceB);

          const { statusCode, body } = await postQuestion(appB, workspaceB, {
            question: DEMO_BUDGET_QUESTION,
          });

          expect(statusCode).toBe(502);
          expect(body.message).toContain('does not exist in workspace');
        } finally {
          await appB.close();
        }

        // The same question against its own workspace still works.
        const { statusCode } = await postQuestion(appA, workspaceA, {
          question: DEMO_BUDGET_QUESTION,
        });
        expect(statusCode).toBe(200);
      } finally {
        await appA.close();
      }
    },
    testTimeout,
  );

  it(
    'rejects malformed question payloads with the standard error shape',
    async () => {
      const ids = makeDemoSchemaIds();
      const app = await buildDemoApp({ ids });

      try {
        const missing = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${newWorkspaceId()}/query`,
          payload: {},
        });
        expect(missing.statusCode).toBe(400);
        expect(missing.json().error).toBe('Bad Request');

        const blank = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${newWorkspaceId()}/query`,
          payload: { question: '   ' },
        });
        expect(blank.statusCode).toBe(400);

        const badSlug = await app.inject({
          method: 'POST',
          url: '/api/v1/workspaces/Not_A_Slug/query',
          payload: { question: 'Which leads have a budget over 5000?' },
        });
        expect(badSlug.statusCode).toBe(400);
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );
});
