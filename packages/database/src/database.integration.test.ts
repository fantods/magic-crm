import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FormlessDatabase } from './database.js';
import { acquireRecordTableLock } from './locks.js';
import { runMigrations } from './migrator.js';
import { IngestionRepository } from './repositories/ingestion-repository.js';
import { RecordRepository } from './repositories/record-repository.js';
import { SchemaCatalogRepository } from './repositories/schema-catalog-repository.js';
import { SchemaEventRepository } from './repositories/schema-event-repository.js';
import { WorkspaceRepository } from './repositories/workspace-repository.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const testTimeout = 15_000;

describe.skipIf(!databaseUrl)('PostgreSQL database core', () => {
  const database = new FormlessDatabase({
    connectionString: databaseUrl,
    max: 4,
    applicationName: 'magic-crm-tests',
  });
  const workspaces = new WorkspaceRepository();
  const schemaEvents = new SchemaEventRepository();
  const catalog = new SchemaCatalogRepository();
  const records = new RecordRepository();
  const ingestions = new IngestionRepository();
  let workspaceId = '';
  let tableId = '';

  beforeAll(async () => {
    await runMigrations(database.pool);
  }, testTimeout);

  afterAll(async () => {
    await database.close();
  });

  function newWorkspaceId(): string {
    return `m2-${randomUUID().replace(/-/g, '').slice(0, 20)}`;
  }

  function contentHash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  it(
    'creates schema events, projections, and records atomically',
    async () => {
      workspaceId = newWorkspaceId();
      tableId = randomUUID();
      const columnId = randomUUID();

      const ingestionId = await database.withTransaction(async (client) => {
        await workspaces.ensure(client, workspaceId, 'Milestone 2 workspace');
        const ingestion = await ingestions.ensure(client, {
          workspaceId,
          idempotencyKey: `atomic-${randomUUID()}`,
          input: { body: 'We have three clinics.' },
        });

        await schemaEvents.append(client, {
          workspaceId,
          ingestionId: ingestion.id,
          events: [
            {
              eventType: 'table_accepted',
              payload: { tableId, name: 'leads' },
              actor: { pass: 'reviewer' },
            },
            {
              eventType: 'column_accepted',
              payload: { columnId, tableId, name: 'locations_count', type: 'integer' },
              actor: { pass: 'reviewer' },
            },
          ],
        });

        const table = await catalog.ensureTable(client, {
          id: tableId,
          workspaceId,
          name: 'leads',
          description: 'Inbound lead records',
          aliases: ['lead'],
        });
        const column = await catalog.ensureColumn(client, {
          id: columnId,
          workspaceId,
          tableId: table.id,
          name: 'locations_count',
          type: 'integer',
          aliases: ['clinics'],
          unit: 'locations',
        });
        const merged = await catalog.mergeColumnAlias(
          client,
          workspaceId,
          column.id,
          'distribution centres',
        );
        const revision = await schemaEvents.currentRevision(client, workspaceId);
        const record = await records.create(client, {
          workspaceId,
          tableId: table.id,
          data: { locations_count: 3 },
          evidence: {
            locations_count: [
              { source: 'body', text: 'three clinics', startIndex: 7, endIndex: 20 },
            ],
          },
          source: { body: 'We have three clinics.' },
          schemaRevision: revision,
          contentHash: contentHash('We have three clinics.'),
          idempotencyKey: `record-${randomUUID()}`,
        });
        const replayed = await records.create(client, {
          workspaceId,
          tableId: table.id,
          data: { locations_count: 3 },
          evidence: {},
          source: { body: 'We have three clinics.' },
          schemaRevision: revision,
          contentHash: contentHash('We have three clinics.'),
          idempotencyKey: record.idempotencyKey,
          id: randomUUID(),
        });

        expect(table.name).toBe('leads');
        expect(column.name).toBe('locations_count');
        expect(merged.aliases).toEqual(['clinics', 'distribution centres']);
        expect(revision).toBe(2);
        expect(record.data).toEqual({ locations_count: 3 });
        expect(replayed.id).toBe(record.id);

        return ingestion.id;
      });

      const storedEvents = await database.withTransaction((client) =>
        schemaEvents.list(client, workspaceId, ingestionId),
      );
      expect(storedEvents.map((event) => event.eventType)).toEqual([
        'table_accepted',
        'column_accepted',
      ]);
    },
    testTimeout,
  );

  it(
    'serializes concurrent record writes for one logical table',
    async () => {
      const writeIds = Array.from({ length: 5 }, () => randomUUID());
      const ingestionIds = await database.withTransaction(async (client) => {
        const ids: string[] = [];
        for (const writeId of writeIds) {
          const ingestion = await ingestions.ensure(client, {
            workspaceId,
            idempotencyKey: `concurrent-${writeId}`,
            input: { body: `Concurrent write ${writeId}` },
          });
          ids.push(ingestion.id);
        }
        return ids;
      });

      await Promise.all(
        writeIds.map((writeId, index) =>
          database.withTransaction(async (client) => {
            await acquireRecordTableLock(client, workspaceId, tableId);
            await records.create(client, {
              workspaceId,
              tableId,
              data: { writeId },
              evidence: {},
              source: { body: `Concurrent write ${writeId}` },
              schemaRevision: 2,
              contentHash: contentHash(writeId),
              idempotencyKey: `concurrent-record-${writeId}`,
            });
            expect(ingestionIds[index]).toBeDefined();
          }),
        ),
      );

      const listed = await database.withTransaction((client) =>
        records.listByTable(client, workspaceId, tableId, 20),
      );
      expect(listed).toHaveLength(6);
    },
    testTimeout,
  );

  it(
    'lists schema events with pagination and fetches ingestions workspace-scoped',
    async () => {
      const paginatedWorkspaceId = newWorkspaceId();
      await database.withTransaction(async (client) => {
        await workspaces.ensure(client, paginatedWorkspaceId, 'Milestone 5 pagination workspace');
        const ingestion = await ingestions.ensure(client, {
          workspaceId: paginatedWorkspaceId,
          idempotencyKey: `pagination-${randomUUID()}`,
          input: { body: 'Pagination probe.' },
        });

        await schemaEvents.append(client, {
          workspaceId: paginatedWorkspaceId,
          ingestionId: ingestion.id,
          events: [1, 2, 3].map((n) => ({
            eventType: 'table_accepted' as const,
            payload: { probe: n },
            actor: { pass: 'test' },
          })),
        });
      });

      const page = await database.withTransaction((client) =>
        schemaEvents.listPage(client, paginatedWorkspaceId, { limit: 2, offset: 0 }),
      );
      expect(page.events).toHaveLength(2);
      expect(page.total).toBe(3);
      expect(page.events.map((event) => event.sequence)).toEqual([1, 2]);

      const lastPage = await database.withTransaction((client) =>
        schemaEvents.listPage(client, paginatedWorkspaceId, { limit: 2, offset: 2 }),
      );
      expect(lastPage.events).toHaveLength(1);
      expect(lastPage.total).toBe(3);

      const scoped = await database.withTransaction(async (client) => {
        const rows = await database.pool.query<{ id: string }>(
          'SELECT id FROM ingestions WHERE workspace_id = $1',
          [paginatedWorkspaceId],
        );
        const found = await ingestions.getInWorkspace(
          client,
          paginatedWorkspaceId,
          rows.rows[0]!.id,
        );
        const wrongWorkspace = await ingestions.getInWorkspace(
          client,
          newWorkspaceId(),
          rows.rows[0]!.id,
        );
        return { found, wrongWorkspace };
      });
      expect(scoped.found).not.toBeNull();
      expect(scoped.wrongWorkspace).toBeNull();
    },
    testTimeout,
  );

  it(
    'isolates workspace schemas and prevents schema journal mutations',
    async () => {
      const isolatedWorkspaceId = newWorkspaceId();
      await database.withTransaction(async (client) => {
        await workspaces.ensure(client, isolatedWorkspaceId, 'Isolated workspace');
        const schema = await catalog.getSchema(client, isolatedWorkspaceId);
        expect(schema.tables).toHaveLength(0);
      });

      await expect(
        database.pool.query('UPDATE schema_events SET payload = payload WHERE workspace_id = $1', [
          workspaceId,
        ]),
      ).rejects.toThrow('schema_events is append-only');
    },
    testTimeout,
  );
});
