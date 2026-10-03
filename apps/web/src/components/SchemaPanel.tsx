import type { SchemaCatalogResponse } from '@formless/contracts';
import { EmptyState, Loading, PanelError } from './Feedback.js';

export interface SchemaPanelProps {
  readonly catalog: SchemaCatalogResponse | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
}

export function SchemaPanel({ catalog, isLoading, error }: SchemaPanelProps) {
  return (
    <section className="panel panel-schema" aria-labelledby="schema-panel-heading">
      <div className="panel-title-row">
        <h2 id="schema-panel-heading">2 · Generated schema</h2>
        {catalog ? (
          <span className="revision-badge" title="Newest schema event sequence">
            revision {catalog.revision}
          </span>
        ) : null}
      </div>

      {error ? <PanelError error={error} /> : null}
      {isLoading ? <Loading label="Loading schema…" /> : null}
      {catalog && catalog.tables.length === 0 ? (
        <EmptyState>
          No logical tables yet. Paste an email on the left to create the first one.
        </EmptyState>
      ) : null}

      {catalog?.tables.map(({ table, columns }) => (
        <article key={table.id} className="schema-table" data-table-name={table.name}>
          <header>
            <h3>
              <code>{table.name}</code>
            </h3>
            {table.aliases.length > 0 ? (
              <p className="alias-line">also known as {table.aliases.join(', ')}</p>
            ) : null}
            {table.description ? <p className="description-line">{table.description}</p> : null}
          </header>
          {columns.length === 0 ? (
            <EmptyState>No columns yet.</EmptyState>
          ) : (
            <table className="schema-columns">
              <thead>
                <tr>
                  <th scope="col">Column</th>
                  <th scope="col">Type</th>
                  <th scope="col">Aliases</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((column) => (
                  <tr key={column.id}>
                    <td>
                      <code>{column.name}</code>
                    </td>
                    <td>
                      <span className={`type-chip type-${column.type}`}>{column.type}</span>
                    </td>
                    <td className="alias-cell">{column.aliases.join(', ') || '—'}</td>
                    <td className="description-cell">{column.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      ))}
    </section>
  );
}
