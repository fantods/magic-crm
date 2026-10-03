import type { Record, RecordsResponse, SchemaCatalogTable } from '@formless/contracts';
import { EvidenceExcerpts } from './Evidence.js';
import { formatCellValue } from './values.js';
import { EmptyState, Loading, PanelError } from './Feedback.js';

export interface RecordsPanelProps {
  readonly tables: readonly SchemaCatalogTable[];
  readonly selectedTableId: string | undefined;
  readonly onSelectTable: (tableId: string) => void;
  readonly records: RecordsResponse['records'] | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
}

export function RecordsPanel({
  tables,
  selectedTableId,
  onSelectTable,
  records,
  isLoading,
  error,
}: RecordsPanelProps) {
  const selected = tables.find(({ table }) => table.id === selectedTableId);

  return (
    <section className="panel panel-records" aria-labelledby="records-panel-heading">
      <h2 id="records-panel-heading">3 · Records</h2>

      {tables.length > 0 ? (
        <div className="field-row">
          <label htmlFor="records-table-select">Table</label>
          <select
            id="records-table-select"
            value={selectedTableId ?? ''}
            onChange={(event) => onSelectTable(event.target.value)}
          >
            {tables.map(({ table }) => (
              <option key={table.id} value={table.id}>
                {table.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {error ? <PanelError error={error} /> : null}
      {isLoading && selectedTableId !== undefined ? <Loading label="Loading records…" /> : null}

      {!selected ? (
        <EmptyState>No tables yet. Ingest an email to create the first logical table.</EmptyState>
      ) : records !== undefined && records.length === 0 ? (
        <EmptyState>No records in “{selected.table.name}” yet.</EmptyState>
      ) : selected && records !== undefined && records.length > 0 ? (
        <RecordGrid table={selected} records={records} />
      ) : null}
    </section>
  );
}

function RecordGrid({ table, records }: { table: SchemaCatalogTable; records: readonly Record[] }) {
  const nameById = new Map(table.columns.map((column) => [column.id, column.name]));

  return (
    <div className="grid-scroll">
      <table
        className="record-grid"
        data-table-name={table.table.name}
        aria-label={`Records in ${table.table.name}`}
      >
        <thead>
          <tr>
            {table.columns.map((column) => (
              <th key={column.id} scope="col">
                <code>{column.name}</code>
                <span className={`type-chip type-${column.type}`}>{column.type}</span>
              </th>
            ))}
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              {table.columns.map((column) => (
                <td key={column.id}>{formatCellValue(record.data[column.id])}</td>
              ))}
              <td>
                <details className="evidence-details">
                  <summary>Evidence</summary>
                  <EvidenceForRecord record={record} nameById={nameById} />
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvidenceForRecord({
  record,
  nameById,
}: {
  record: Record;
  nameById: Map<string, string>;
}) {
  const entries = Object.entries(record.evidence).filter(
    ([, excerpts]) => Array.isArray(excerpts) && excerpts.length > 0,
  );
  if (entries.length === 0) {
    return <p className="evidence-empty">No evidence recorded for this record.</p>;
  }
  return (
    <div className="evidence-map">
      {entries.map(([columnId, excerpts]) => (
        <div key={columnId} className="evidence-entry">
          <h4>
            <code>{nameById.get(columnId) ?? columnId}</code>
          </h4>
          <EvidenceExcerpts evidence={excerpts} />
        </div>
      ))}
    </div>
  );
}
