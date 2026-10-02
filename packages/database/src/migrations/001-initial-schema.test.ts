import { describe, expect, it } from 'vitest';
import { initialSchemaMigration } from './001-initial-schema.js';

describe('initial schema migration', () => {
  it('defines the core application tables', () => {
    for (const table of [
      'workspaces',
      'ingestions',
      'schema_events',
      'record_tables',
      'record_columns',
      'records',
    ]) {
      expect(initialSchemaMigration.up).toContain(`CREATE TABLE ${table}`);
    }
  });

  it('enforces append-only schema history', () => {
    expect(initialSchemaMigration.up).toContain('CREATE TRIGGER schema_events_append_only_trigger');
    expect(initialSchemaMigration.up).toContain('BEFORE UPDATE OR DELETE ON schema_events');
  });

  it('defines idempotency and workspace isolation indexes', () => {
    expect(initialSchemaMigration.up).toContain(
      'CREATE UNIQUE INDEX ingestions_workspace_idempotency_key_uidx',
    );
    expect(initialSchemaMigration.up).toContain(
      'CREATE UNIQUE INDEX records_workspace_idempotency_key_uidx',
    );
    expect(initialSchemaMigration.up).toContain(
      'CREATE UNIQUE INDEX schema_events_workspace_sequence_uidx',
    );
  });
});
