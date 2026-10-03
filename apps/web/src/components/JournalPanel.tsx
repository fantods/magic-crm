import type { SchemaEvent } from '@formless/contracts';
import { describeSchemaEvent } from './journal.js';
import { EmptyState, Loading, PanelError } from './Feedback.js';

export interface JournalPanelProps {
  readonly events: readonly SchemaEvent[] | undefined;
  readonly total: number | undefined;
  readonly isLoading: boolean;
  readonly error: unknown;
}

export function JournalPanel({ events, total, isLoading, error }: JournalPanelProps) {
  const ordered = events === undefined ? [] : [...events].sort((a, b) => b.sequence - a.sequence);

  return (
    <section className="panel panel-journal" aria-labelledby="journal-panel-heading">
      <div className="panel-title-row">
        <h2 id="journal-panel-heading">4 · Journal</h2>
        {total !== undefined ? (
          <span className="revision-badge" title="Append-only schema decisions">
            {total} {total === 1 ? 'decision' : 'decisions'}
          </span>
        ) : null}
      </div>

      {error ? <PanelError error={error} /> : null}
      {isLoading ? <Loading label="Loading journal…" /> : null}
      {events !== undefined && events.length === 0 ? (
        <EmptyState>
          No schema decisions yet. Every accepted or rejected change lands here.
        </EmptyState>
      ) : null}

      <ol className="journal-list">
        {ordered.map((event) => {
          const description = describeSchemaEvent(event);
          return (
            <li key={event.id} className={`journal-entry journal-${description.kind}`}>
              <div className="journal-entry-header">
                <span className="sequence-badge">#{event.sequence}</span>
                <span className={`kind-chip kind-${description.kind}`}>{description.kind}</span>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleTimeString()}
                </time>
              </div>
              <p className="journal-summary">{description.summary}</p>
              {description.detail ? <p className="journal-detail">{description.detail}</p> : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
