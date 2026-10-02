import {
  columnTypeSchema,
  workspaceIdSchema,
  type RecordColumn,
  type RecordTable,
} from '@formless/contracts';
import { mapRecordColumnRow, mapRecordTableRow, type DatabaseExecutor } from '../mapping.js';

export interface EnsureTableInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description?: string;
  readonly aliases?: readonly string[];
}

export interface EnsureColumnInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly tableId: string;
  readonly name: string;
  readonly type: Parameters<typeof columnTypeSchema.parse>[0];
  readonly description?: string;
  readonly aliases?: readonly string[];
  readonly unit?: string;
  readonly enumValues?: readonly string[];
}

export interface WorkspaceSchema {
  readonly tables: readonly {
    readonly table: RecordTable;
    readonly columns: readonly RecordColumn[];
  }[];
}

export class SchemaCatalogRepository {
  async ensureTable(executor: DatabaseExecutor, input: EnsureTableInput): Promise<RecordTable> {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const insert = await executor.query(
      `
      INSERT INTO record_tables(id, workspace_id, name, description, aliases)
      VALUES ($1, $2, $3, $4, $5::jsonb)
      ON CONFLICT (workspace_id, lower(name)) DO NOTHING
      RETURNING id, workspace_id, name, description, aliases, created_at
    `,
      [
        input.id,
        workspaceId,
        input.name,
        input.description ?? null,
        JSON.stringify(input.aliases ?? []),
      ],
    );

    if (insert.rows[0]) {
      return mapRecordTableRow(insert.rows[0]);
    }

    return this.getTableByName(executor, workspaceId, input.name);
  }

  async getTable(
    executor: DatabaseExecutor,
    workspaceId: string,
    tableId: string,
  ): Promise<RecordTable | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, name, description, aliases, created_at
        FROM record_tables
        WHERE workspace_id = $1 AND id = $2
      `,
      [id, tableId],
    );

    return result.rows[0] ? mapRecordTableRow(result.rows[0]) : null;
  }

  async getTableByName(
    executor: DatabaseExecutor,
    workspaceId: string,
    name: string,
  ): Promise<RecordTable> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, name, description, aliases, created_at
        FROM record_tables
        WHERE workspace_id = $1 AND lower(name) = lower($2)
      `,
      [id, name],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error(`Record table ${name} was not found in workspace ${id}`);
    }

    return mapRecordTableRow(row);
  }

  async ensureColumn(executor: DatabaseExecutor, input: EnsureColumnInput): Promise<RecordColumn> {
    const workspaceId = workspaceIdSchema.parse(input.workspaceId);
    const type = columnTypeSchema.parse(input.type);
    const insert = await executor.query(
      `
      INSERT INTO record_columns(
        id,
        workspace_id,
        table_id,
        name,
        type,
        description,
        aliases,
        unit,
        enum_values
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb)
      ON CONFLICT (workspace_id, table_id, lower(name)) DO NOTHING
      RETURNING id, workspace_id, table_id, name, type, description, aliases, unit, enum_values, created_at
    `,
      [
        input.id,
        workspaceId,
        input.tableId,
        input.name,
        type,
        input.description ?? null,
        JSON.stringify(input.aliases ?? []),
        input.unit ?? null,
        input.enumValues ? JSON.stringify(input.enumValues) : null,
      ],
    );

    if (insert.rows[0]) {
      return mapRecordColumnRow(insert.rows[0]);
    }

    return this.getColumnByName(executor, workspaceId, input.tableId, input.name);
  }

  async getColumn(
    executor: DatabaseExecutor,
    workspaceId: string,
    columnId: string,
  ): Promise<RecordColumn | null> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, table_id, name, type, description, aliases, unit, enum_values, created_at
        FROM record_columns
        WHERE workspace_id = $1 AND id = $2
      `,
      [id, columnId],
    );

    return result.rows[0] ? mapRecordColumnRow(result.rows[0]) : null;
  }

  async getColumnByName(
    executor: DatabaseExecutor,
    workspaceId: string,
    tableId: string,
    name: string,
  ): Promise<RecordColumn> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        SELECT id, workspace_id, table_id, name, type, description, aliases, unit, enum_values, created_at
        FROM record_columns
        WHERE workspace_id = $1 AND table_id = $2 AND lower(name) = lower($3)
      `,
      [id, tableId, name],
    );
    const row = result.rows[0];

    if (!row) {
      throw new Error(`Record column ${name} was not found`);
    }

    return mapRecordColumnRow(row);
  }

  async mergeColumnAlias(
    executor: DatabaseExecutor,
    workspaceId: string,
    columnId: string,
    alias: string,
  ): Promise<RecordColumn> {
    const id = workspaceIdSchema.parse(workspaceId);
    const result = await executor.query(
      `
        UPDATE record_columns
        SET aliases = CASE
          WHEN aliases ? $3::text THEN aliases
          ELSE aliases || to_jsonb($3::text)
        END
        WHERE workspace_id = $1 AND id = $2
        RETURNING id, workspace_id, table_id, name, type, description, aliases, unit, enum_values, created_at
      `,
      [id, columnId, alias],
    );

    if (!result.rows[0]) {
      throw new Error(`Record column ${columnId} was not found`);
    }

    return mapRecordColumnRow(result.rows[0]);
  }

  async getSchema(executor: DatabaseExecutor, workspaceId: string): Promise<WorkspaceSchema> {
    const id = workspaceIdSchema.parse(workspaceId);
    const tables = await executor.query(
      `
        SELECT id, workspace_id, name, description, aliases, created_at
        FROM record_tables
        WHERE workspace_id = $1
        ORDER BY created_at, name
      `,
      [id],
    );
    const columns = await executor.query(
      `
        SELECT id, workspace_id, table_id, name, type, description, aliases, unit, enum_values, created_at
        FROM record_columns
        WHERE workspace_id = $1
        ORDER BY created_at, name
      `,
      [id],
    );

    const columnsByTable = new Map<string, RecordColumn[]>();
    for (const row of columns.rows) {
      const column = mapRecordColumnRow(row);
      const existing = columnsByTable.get(column.tableId) ?? [];
      existing.push(column);
      columnsByTable.set(column.tableId, existing);
    }

    return {
      tables: tables.rows.map((row) => {
        const table = mapRecordTableRow(row);
        return { table, columns: columnsByTable.get(table.id) ?? [] };
      }),
    };
  }
}
