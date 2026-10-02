import { describe, expect, it } from 'vitest';
import {
  columnTypeSchema,
  emailIngestionInputSchema,
  ingestEmailResponseSchema,
  recordSchema,
  schemaEventSchema,
  schemaEventsResponseSchema,
  workspaceIdSchema,
} from './index.js';

describe('contracts', () => {
  it('accepts the complete v1 column type set', () => {
    const values = [
      'text',
      'integer',
      'decimal',
      'boolean',
      'date',
      'datetime',
      'enum',
      'email',
      'url',
      'json',
    ] as const;

    expect(values.map((value) => columnTypeSchema.parse(value))).toEqual(values);
  });

  it('requires workspace IDs to be lowercase slugs', () => {
    expect(workspaceIdSchema.safeParse('demo-workspace').success).toBe(true);
    expect(workspaceIdSchema.safeParse('Demo Workspace').success).toBe(false);
  });

  it('requires an email body', () => {
    const result = emailIngestionInputSchema.safeParse({
      workspaceId: 'demo',
      body: '',
    });

    expect(result.success).toBe(false);
  });

  it('accepts append-only schema events with structured payloads', () => {
    const result = schemaEventSchema.safeParse({
      id: 'b3d1f7cf-6e0c-4985-a1e8-2bb043697987',
      workspaceId: 'demo',
      sequence: 1,
      ingestionId: 'bb2edd81-6bb0-45a8-a91a-9df6bd1c7a95',
      eventType: 'column_accepted',
      payload: { name: 'locations_count', type: 'integer' },
      actor: { model: 'reviewer' },
      createdAt: '2026-10-02T17:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  it('requires evidence arrays on records', () => {
    const result = recordSchema.safeParse({
      id: 'b3d1f7cf-6e0c-4985-a1e8-2bb043697987',
      workspaceId: 'demo',
      tableId: 'bb2edd81-6bb0-45a8-a91a-9df6bd1c7a95',
      data: { locations_count: 3 },
      evidence: { locations_count: 'three clinics' },
      source: { body: 'We have three clinics.' },
      schemaRevision: 1,
      contentHash: 'a'.repeat(64),
      idempotencyKey: 'demo-key',
      createdAt: '2026-10-02T17:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('accepts a complete ingestion response with schema delta and record', () => {
    const ingestionId = 'bb2edd81-6bb0-45a8-a91a-9df6bd1c7a95';
    const result = ingestEmailResponseSchema.safeParse({
      ingestion: {
        id: ingestionId,
        workspaceId: 'demo',
        idempotencyKey: 'email_' + 'a'.repeat(64),
        status: 'completed',
        input: { body: 'We have three clinics.' },
        createdAt: '2026-10-02T17:00:00.000Z',
        updatedAt: '2026-10-02T17:00:01.000Z',
      },
      schemaDelta: {
        table: {
          id: 'c4e2f8df-7f1d-4a96-b2f9-4cc154e8f231',
          workspaceId: 'demo',
          name: 'leads',
          aliases: ['prospect'],
          createdAt: '2026-10-02T17:00:00.000Z',
        },
        tableCreated: true,
        newColumns: [
          {
            id: 'd5f3a9e0-8f2e-4ba7-b3ea-5dd265f9a342',
            workspaceId: 'demo',
            tableId: 'c4e2f8df-7f1d-4a96-b2f9-4cc154e8f231',
            name: 'locations_count',
            type: 'integer',
            aliases: ['clinics'],
            createdAt: '2026-10-02T17:00:00.000Z',
          },
        ],
        mergedColumns: [],
        schemaRevision: 3,
      },
      record: {
        id: 'e6a4bf1f-9a3f-4cb8-b4fb-6ee3760ab453',
        workspaceId: 'demo',
        tableId: 'c4e2f8df-7f1d-4a96-b2f9-4cc154e8f231',
        data: { locations_count: 3 },
        evidence: {
          locations_count: [{ source: 'body', text: 'three clinics' }],
        },
        source: { body: 'We have three clinics.' },
        schemaRevision: 3,
        contentHash: 'a'.repeat(64),
        idempotencyKey: 'email_' + 'a'.repeat(64),
        createdAt: '2026-10-02T17:00:01.000Z',
      },
    });

    expect(result.success).toBe(true);
  });

  it('requires a total count when exposing the schema journal', () => {
    const events = [
      {
        id: 'b3d1f7cf-6e0c-4985-a1e8-2bb043697987',
        workspaceId: 'demo',
        sequence: 1,
        ingestionId: 'bb2edd81-6bb0-45a8-a91a-9df6bd1c7a95',
        eventType: 'record_created',
        payload: {},
        actor: { source: 'ingestion-api' },
        createdAt: '2026-10-02T17:00:00.000Z',
      },
    ];

    expect(schemaEventsResponseSchema.safeParse({ events, total: 1 }).success).toBe(true);
    expect(schemaEventsResponseSchema.safeParse({ events }).success).toBe(false);
  });
});
