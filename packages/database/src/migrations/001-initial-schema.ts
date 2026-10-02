export const initialSchemaMigration = {
  id: '001_initial_schema',
  name: 'Initial workspace, schema journal, and record tables',
  up: /* sql */ `
    CREATE TABLE workspaces (
      id text PRIMARY KEY,
      display_name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT workspaces_id_format_check CHECK (
        id ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
      )
    );

    CREATE TABLE ingestions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      idempotency_key text NOT NULL,
      status text NOT NULL
        CONSTRAINT ingestions_status_check CHECK (
          status IN ('pending', 'processing', 'completed', 'failed')
        ),
      input jsonb NOT NULL,
      normalized jsonb,
      result jsonb,
      error text,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT ingestions_idempotency_key_length_check CHECK (
        char_length(idempotency_key) BETWEEN 8 AND 128
      )
    );

    CREATE UNIQUE INDEX ingestions_workspace_idempotency_key_uidx
      ON ingestions(workspace_id, idempotency_key);

    CREATE INDEX ingestions_workspace_created_at_idx
      ON ingestions(workspace_id, created_at DESC);

    CREATE TABLE record_tables (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name text NOT NULL,
      description text,
      aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT record_tables_name_length_check CHECK (
        char_length(name) BETWEEN 1 AND 100
      ),
      CONSTRAINT record_tables_aliases_json_array_check CHECK (
        jsonb_typeof(aliases) = 'array'
      )
    );

    CREATE UNIQUE INDEX record_tables_workspace_name_uidx
      ON record_tables(workspace_id, lower(name));

    CREATE TABLE record_columns (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      table_id uuid NOT NULL REFERENCES record_tables(id) ON DELETE CASCADE,
      name text NOT NULL,
      type text NOT NULL
        CONSTRAINT record_columns_type_check CHECK (
          type IN (
            'text',
            'integer',
            'decimal',
            'boolean',
            'date',
            'datetime',
            'enum',
            'email',
            'url',
            'json'
          )
        ),
      description text,
      aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      unit text,
      enum_values jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT record_columns_name_length_check CHECK (
        char_length(name) BETWEEN 1 AND 100
      ),
      CONSTRAINT record_columns_aliases_json_array_check CHECK (
        jsonb_typeof(aliases) = 'array'
      ),
      CONSTRAINT record_columns_enum_values_json_array_check CHECK (
        enum_values IS NULL OR jsonb_typeof(enum_values) = 'array'
      )
    );

    CREATE UNIQUE INDEX record_columns_workspace_table_name_uidx
      ON record_columns(workspace_id, table_id, lower(name));

    CREATE TABLE schema_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      sequence integer NOT NULL,
      ingestion_id uuid NOT NULL REFERENCES ingestions(id) ON DELETE RESTRICT,
      event_type text NOT NULL
        CONSTRAINT schema_events_event_type_check CHECK (
          event_type IN (
            'table_proposed',
            'table_accepted',
            'table_rejected',
            'column_proposed',
            'column_accepted',
            'column_rejected',
            'column_merged',
            'record_created'
          )
        ),
      payload jsonb NOT NULL,
      actor jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT schema_events_sequence_positive_check CHECK (sequence > 0),
      CONSTRAINT schema_events_payload_object_check CHECK (
        jsonb_typeof(payload) = 'object'
      ),
      CONSTRAINT schema_events_actor_object_check CHECK (
        jsonb_typeof(actor) = 'object'
      )
    );

    CREATE UNIQUE INDEX schema_events_workspace_sequence_uidx
      ON schema_events(workspace_id, sequence);

    CREATE INDEX schema_events_workspace_ingestion_idx
      ON schema_events(workspace_id, ingestion_id, sequence);

    CREATE FUNCTION prevent_schema_events_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RAISE EXCEPTION 'schema_events is append-only';
    END;
    $$;

    CREATE TRIGGER schema_events_append_only_trigger
      BEFORE UPDATE OR DELETE ON schema_events
      FOR EACH ROW
      EXECUTE FUNCTION prevent_schema_events_mutation();

    CREATE TABLE records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      table_id uuid NOT NULL REFERENCES record_tables(id) ON DELETE CASCADE,
      data jsonb NOT NULL,
      evidence jsonb NOT NULL,
      source jsonb NOT NULL,
      schema_revision integer NOT NULL,
      content_hash text NOT NULL,
      idempotency_key text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT records_data_object_check CHECK (jsonb_typeof(data) = 'object'),
      CONSTRAINT records_evidence_object_check CHECK (jsonb_typeof(evidence) = 'object'),
      CONSTRAINT records_source_object_check CHECK (jsonb_typeof(source) = 'object'),
      CONSTRAINT records_schema_revision_positive_check CHECK (schema_revision > 0),
      CONSTRAINT records_content_hash_length_check CHECK (char_length(content_hash) = 64),
      CONSTRAINT records_idempotency_key_length_check CHECK (
        char_length(idempotency_key) BETWEEN 8 AND 128
      )
    );

    CREATE UNIQUE INDEX records_workspace_idempotency_key_uidx
      ON records(workspace_id, idempotency_key);

    CREATE INDEX records_workspace_table_created_at_idx
      ON records(workspace_id, table_id, created_at DESC);

    CREATE INDEX records_data_jsonb_path_ops_idx
      ON records USING gin(data jsonb_path_ops);
  `,
  down: /* sql */ `
    DROP TABLE records;
    DROP TRIGGER schema_events_append_only_trigger ON schema_events;
    DROP FUNCTION prevent_schema_events_mutation();
    DROP TABLE schema_events;
    DROP TABLE record_columns;
    DROP TABLE record_tables;
    DROP TABLE ingestions;
    DROP TABLE workspaces;
  `,
} as const;
