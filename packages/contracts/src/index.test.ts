import { describe, expect, it } from 'vitest';
import {
  columnTypeSchema,
  emailIngestionInputSchema,
  recordSchema,
  schemaEventSchema,
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
});
