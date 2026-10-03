import { useState, type FormEvent } from 'react';
import type { ComparisonOperator, QueryFilter, QueryResponse } from '@formless/contracts';
import { formatCellValue, formatQueryValue } from './values.js';
import { EmptyState, Loading, PanelError } from './Feedback.js';

export interface QueryPanelProps {
  readonly pending: boolean;
  readonly result: QueryResponse | null;
  readonly error: unknown;
  readonly exampleQuestion: string;
  onAsk: (question: string) => void;
  resolveTableName: (tableId: string) => string;
  resolveColumnName: (columnId: string) => string;
}

const operatorSymbols: Record<ComparisonOperator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  in: 'in',
};

function filterToString(
  filter: QueryFilter,
  resolveColumnName: (columnId: string) => string,
): string {
  if (filter.kind === 'logical') {
    const joiner = filter.operator === 'and' ? ' AND ' : ' OR ';
    const parts = filter.children.map((child) => filterToString(child, resolveColumnName));
    if (parts.length === 1) {
      return parts[0] ?? '';
    }
    return `(${parts.join(joiner)})`;
  }
  const column = resolveColumnName(filter.columnId);
  const symbol = operatorSymbols[filter.operator];
  return `${column} ${symbol} ${formatQueryValue(filter.value)}`;
}

export function QueryPanel({
  pending,
  result,
  error,
  exampleQuestion,
  onAsk,
  resolveTableName,
  resolveColumnName,
}: QueryPanelProps) {
  const [question, setQuestion] = useState('');

  function ask(value: string) {
    const trimmed = value.trim();
    if (trimmed === '') {
      return;
    }
    onAsk(trimmed);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    ask(question);
  }

  return (
    <section className="panel panel-query" aria-labelledby="query-panel-heading">
      <h2 id="query-panel-heading">5 · Natural-language query</h2>
      <p className="panel-hint">
        Ask a question. The planner returns a validated structured query — never SQL — and the
        engine runs it read-only.
      </p>

      <form className="query-form" onSubmit={handleSubmit}>
        <label htmlFor="query-question" className="visually-hidden">
          Question
        </label>
        <input
          id="query-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about your records…"
        />
        <button
          type="submit"
          className="primary-button"
          disabled={pending || question.trim() === ''}
        >
          {pending ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      <button
        type="button"
        className="chip-button"
        title="Run the plan's example query"
        onClick={() => {
          setQuestion(exampleQuestion);
          ask(exampleQuestion);
        }}
      >
        Try: {exampleQuestion}
      </button>

      {error ? <PanelError error={error} /> : null}
      {pending ? <Loading label="Planning the query…" /> : null}

      {result ? (
        <div className="query-result" data-testid="query-result">
          <p className="query-interpretation">
            <strong>Interpreted as:</strong> {result.interpretation}
          </p>

          <div className="query-structured">
            <h3>Structured query</h3>
            <dl>
              <dt>Table</dt>
              <dd>
                <code>{resolveTableName(result.query.tableId)}</code>
              </dd>
              {result.query.filter ? (
                <>
                  <dt>Filter</dt>
                  <dd>
                    <code>{filterToString(result.query.filter, resolveColumnName)}</code>
                  </dd>
                </>
              ) : null}
              {result.query.orderBy ? (
                <>
                  <dt>Order by</dt>
                  <dd>
                    <code>
                      {resolveColumnName(result.query.orderBy.columnId)}{' '}
                      {result.query.orderBy.direction}
                    </code>
                  </dd>
                </>
              ) : null}
              {result.query.limit !== undefined ? (
                <>
                  <dt>Limit</dt>
                  <dd>{result.query.limit}</dd>
                </>
              ) : null}
            </dl>
          </div>

          {result.warnings.length > 0 ? (
            <div className="note note-warning" role="alert">
              <p>
                <strong>Ambiguity warnings</strong>
              </p>
              <ul>
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <h3 className="result-heading">
            Result — {result.records.length} {result.records.length === 1 ? 'record' : 'records'}
          </h3>
          {result.records.length === 0 ? (
            <EmptyState>The query matched no records.</EmptyState>
          ) : (
            <QueryResultTable records={result.records} resolveColumnName={resolveColumnName} />
          )}
        </div>
      ) : null}
    </section>
  );
}

function QueryResultTable({
  records,
  resolveColumnName,
}: {
  records: QueryResponse['records'];
  resolveColumnName: (columnId: string) => string;
}) {
  // Result records key data and evidence by internal column ids.
  const columnIds: string[] = [];
  for (const record of records) {
    for (const key of Object.keys(record.data)) {
      if (!columnIds.includes(key)) {
        columnIds.push(key);
      }
    }
  }

  return (
    <div className="grid-scroll">
      <table className="record-grid query-result-grid">
        <thead>
          <tr>
            {columnIds.map((columnId) => (
              <th key={columnId} scope="col">
                <code>{resolveColumnName(columnId)}</code>
              </th>
            ))}
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              {columnIds.map((columnId) => (
                <td key={columnId}>{formatCellValue(record.data[columnId])}</td>
              ))}
              <td>
                <details className="evidence-details">
                  <summary>Evidence</summary>
                  <ul className="evidence-list">
                    {Object.entries(record.evidence).flatMap(([columnId, excerpts]) =>
                      excerpts.map((excerpt, index) => (
                        <li key={`${columnId}-${index}`}>
                          <blockquote className="evidence-text">“{excerpt.text}”</blockquote>
                          <span className="evidence-source">
                            {resolveColumnName(columnId)} · from {excerpt.source}
                          </span>
                        </li>
                      )),
                    )}
                  </ul>
                </details>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
