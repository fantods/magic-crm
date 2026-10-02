import type { ColumnType } from '@formless/contracts';

export interface SchemaColumnSnapshot {
  readonly id: string;
  readonly name: string;
  readonly type: ColumnType;
  readonly aliases: readonly string[];
  readonly unit?: string;
  readonly enumValues?: readonly string[];
}

export interface SchemaTableSnapshot {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly columns: readonly SchemaColumnSnapshot[];
}

export interface SchemaSnapshot {
  readonly tables: readonly SchemaTableSnapshot[];
}

export const emptySchema: SchemaSnapshot = { tables: [] };

export function findTableById(
  schema: SchemaSnapshot,
  tableId: string,
): SchemaTableSnapshot | undefined {
  return schema.tables.find((table) => table.id === tableId);
}

export function findColumnById(
  table: SchemaTableSnapshot,
  columnId: string,
): SchemaColumnSnapshot | undefined {
  return table.columns.find((column) => column.id === columnId);
}
