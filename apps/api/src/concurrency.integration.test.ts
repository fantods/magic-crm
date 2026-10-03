import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeArchitectModel, FakeReviewerModel } from '@formless/testing';
import type { ArchitectProposal, QueryPlannerModel, ReviewerDecision } from '@formless/core';
import type { IngestEmailResponse } from '@formless/contracts';
import { FormlessDatabase, runMigrations } from '@formless/database';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { ApiModels } from './models.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const testTimeout = 30_000;

/**
 * Milestone 8 concurrency stress (acceptance criterion 6): five concurrent
 * writes to one logical table must create five records.
 *
 * One setup email creates the `leads` table with its `locations_count`
 * column; five further emails then target the existing table concurrently.
 * Every concurrent write plans against the same committed schema, serializes
 * on the `workspace:table` advisory lock, and lands its own record — none may
 * answer 409 or 5xx. Evidence texts are exact substrings of their bodies so
 * source verification passes.
 *
 * `record_tables.id` is a global primary key, so the run mints its own ids
 * (same convention as the other integration tests) and rewrites the fixture
 * references to match.
 */
const seedEmail = {
  body: 'Harborview Medical runs three clinics and budgets 4100 for the rollout.',
  sitesEvidence: 'three clinics',
};

const concurrentEmails = [
  {
    body: 'Cedarline Group operates six depots for the eastern region.',
    sites: 6,
    evidence: 'six depots',
    alias: 'depots_count',
  },
  {
    body: 'Summit Foods owns eighteen distribution centres nationwide.',
    sites: 18,
    evidence: 'eighteen distribution centres',
    alias: 'distribution_centres_count',
  },
  {
    body: 'Brightpath Labs has nine sites to onboard this quarter.',
    sites: 9,
    evidence: 'nine sites',
    alias: 'sites_count',
  },
  {
    body: 'Kestrel Freight manages twelve warehouses across two states.',
    sites: 12,
    evidence: 'twelve warehouses',
    alias: 'warehouses_count',
  },
  {
    body: 'Lumen Retail runs twenty outlet stores in the capital region.',
    sites: 20,
    evidence: 'twenty outlet stores',
    alias: 'outlets_count',
  },
] as const;

interface StressSchemaIds {
  readonly tableId: string;
  readonly locationsColumnId: string;
}

/**
 * Builds the deterministic model fixtures for the given run's schema ids.
 * The architect proposes a `sites` field for every email; the reviewer folds
 * every concurrent email into the seeded table's `locations_count` column.
 */
function buildStressFixtures(ids: StressSchemaIds): {
  architect: Record<string, ArchitectProposal>;
  reviewer: Record<string, ReviewerDecision>;
} {
  const architect: Record<string, ArchitectProposal> = {
    [seedEmail.body]: {
      table: {
        kind: 'new',
        name: 'Lead',
        description: 'Inbound sales lead',
        aliases: ['prospect'],
      },
      fields: [
        {
          key: 'sites',
          columnName: 'clinics_count',
          type: 'integer',
          value: 3,
          evidence: { source: 'body', text: seedEmail.sitesEvidence },
          rationale: 'The sender states a site count.',
        },
      ],
    },
  };
  const reviewer: Record<string, ReviewerDecision> = {
    [seedEmail.body]: {
      table: {
        action: 'accept_new',
        name: 'leads',
        description: 'Inbound sales leads',
        aliases: ['prospect', 'opportunity'],
        rationale: 'The email is a sales lead.',
      },
      fields: [
        {
          action: 'accept_new',
          fieldKey: 'sites',
          columnName: 'locations_count',
          type: 'integer',
          rationale: 'Site counts fold into one durable column.',
        },
      ],
    },
  };
  for (const email of concurrentEmails) {
    architect[email.body] = {
      table: { kind: 'existing', tableId: ids.tableId },
      fields: [
        {
          key: 'sites',
          columnName: email.alias,
          type: 'integer',
          value: email.sites,
          evidence: { source: 'body', text: email.evidence },
          rationale: 'The sender states a site count.',
        },
      ],
    };
    reviewer[email.body] = {
      table: {
        action: 'use_existing',
        tableId: ids.tableId,
        rationale: 'This is another inbound sales lead.',
      },
      fields: [
        {
          action: 'map_existing',
          fieldKey: 'sites',
          existingColumnId: ids.locationsColumnId,
          rationale: 'All site counts belong in locations_count.',
        },
      ],
    };
  }
  return { architect, reviewer };
}

describe.skipIf(!databaseUrl)('Concurrency stress (PostgreSQL-backed)', () => {
  const database = new FormlessDatabase({
    connectionString: databaseUrl,
    max: 10,
    applicationName: 'magic-crm-m8-stress-tests',
  });

  beforeAll(async () => {
    await runMigrations(database.pool);
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  });

  it(
    'creates five records for five concurrent writes to one logical table',
    async () => {
      const workspaceId = `m8-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const ids: StressSchemaIds = {
        tableId: randomUUID(),
        locationsColumnId: randomUUID(),
      };
      const { architect, reviewer } = buildStressFixtures(ids);

      // Deterministic ids for the seed ingestion only; concurrent writes
      // generate none (use_existing + map_existing), so any call beyond the
      // seeded two signals a fixture bug and fails the run.
      const idQueue = [ids.tableId, ids.locationsColumnId];
      let nextId = 0;
      const generateId = (): string => {
        const id = idQueue[nextId];
        nextId += 1;
        if (!id) {
          throw new Error('Unexpected additional ID request in stress fixtures');
        }
        return id;
      };

      const models: ApiModels = {
        architect: new FakeArchitectModel(architect),
        reviewer: new FakeReviewerModel(reviewer),
        planner: {
          plan: () =>
            Promise.reject(new Error('Queries are not exercised in the concurrency stress test')),
        } satisfies QueryPlannerModel,
        label: 'fake-stress',
      };
      const app: FastifyInstance = await buildApp({ database, models, generateId });

      try {
        // Seed the logical table sequentially so every concurrent write plans
        // against the same committed schema.
        const seed = await app.inject({
          method: 'POST',
          url: `/api/v1/workspaces/${workspaceId}/ingestions`,
          payload: { body: seedEmail.body },
        });
        expect(seed.statusCode, JSON.stringify(seed.json())).toBe(201);
        expect(seed.json<IngestEmailResponse>().schemaDelta.table.id).toBe(ids.tableId);

        const responses = await Promise.all(
          concurrentEmails.map(({ body }) =>
            app.inject({
              method: 'POST',
              url: `/api/v1/workspaces/${workspaceId}/ingestions`,
              payload: { body },
            }),
          ),
        );

        // Every write succeeds; none is rejected as a conflict or server error.
        const bodies = responses.map((response) => ({
          statusCode: response.statusCode,
          body: response.json() as IngestEmailResponse & { message?: string },
        }));
        for (const { statusCode, body } of bodies) {
          expect(statusCode, body.message).toBe(201);
        }

        // Five records, five fresh completed ingestions (plus the seed), all
        // in the one logical table. The seed record also counts, hence six
        // records from six ingestions; the five concurrent writes contributed
        // exactly five of them.
        const counts = await database.pool.query<{
          records: string;
          ingestions: string;
          tables: string;
        }>(
          `
          SELECT
            (SELECT COUNT(*) FROM records WHERE workspace_id = $1) AS records,
            (SELECT COUNT(*) FROM ingestions WHERE workspace_id = $1 AND status = 'completed') AS ingestions,
            (SELECT COUNT(*) FROM record_tables WHERE workspace_id = $1) AS tables
        `,
          [workspaceId],
        );
        expect(Number(counts.rows[0]!.records)).toBe(6);
        expect(Number(counts.rows[0]!.ingestions)).toBe(6);
        expect(Number(counts.rows[0]!.tables)).toBe(1);

        // The concurrent synonym merges folded into exactly one column.
        const columns = await database.pool.query<{ name: string; aliases: string[] }>(
          'SELECT name, aliases FROM record_columns WHERE workspace_id = $1 ORDER BY name',
          [workspaceId],
        );
        expect(columns.rows.map((row) => row.name)).toEqual(['locations_count']);
        expect(columns.rows[0]!.aliases).toEqual(
          expect.arrayContaining(concurrentEmails.map((email) => email.alias)),
        );

        // Every concurrent write carries its own canonical site count (plus
        // the seed record's 3).
        const recordValues = await database.pool.query<{ value: number }>(
          'SELECT (data ->> $2)::integer AS value FROM records WHERE workspace_id = $1 ORDER BY value',
          [workspaceId, ids.locationsColumnId],
        );
        expect(recordValues.rows.map((row) => row.value)).toEqual([3, 6, 9, 12, 18, 20]);

        // Sequence allocation stayed unique and gap-free under contention.
        const sequences = await database.pool.query<{ sequence: number }>(
          'SELECT sequence FROM schema_events WHERE workspace_id = $1 ORDER BY sequence',
          [workspaceId],
        );
        const values = sequences.rows.map((row) => row.sequence);
        expect(new Set(values).size).toBe(values.length);
        expect(values).toEqual(values.map((_, index) => index + 1));
      } finally {
        await app.close();
      }
    },
    testTimeout,
  );
});
