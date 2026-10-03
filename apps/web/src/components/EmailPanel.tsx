import { useState, type FormEvent } from 'react';
import type { IngestEmailResponse } from '@formless/contracts';
import type { IngestEmailRequest } from '../api/client.js';
import { demoEmailScripts } from '../demo/demo-scripts.js';
import { PanelError } from './Feedback.js';

export interface EmailPanelProps {
  readonly pending: boolean;
  readonly lastResult: IngestEmailResponse | null;
  readonly error: unknown;
  readonly onSubmit: (input: IngestEmailRequest) => void;
}

export function EmailPanel({ pending, lastResult, error, onSubmit }: EmailPanelProps) {
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  function applyScript(scriptId: string) {
    const script = demoEmailScripts.find((candidate) => candidate.id === scriptId);
    if (!script) {
      return;
    }
    setBody(script.email.body);
    setSubject(script.email.subject);
    setFrom(script.email.from);
    setTo(script.email.to);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (trimmedBody === '') {
      return;
    }
    onSubmit({
      body: trimmedBody,
      ...(subject.trim() === '' ? {} : { subject: subject.trim() }),
      ...(from.trim() === '' ? {} : { from: from.trim() }),
      ...(to.trim() === '' ? {} : { to: to.trim() }),
    });
  }

  return (
    <section className="panel panel-email" aria-labelledby="email-panel-heading">
      <h2 id="email-panel-heading">1 · Email input</h2>
      <p className="panel-hint">
        Paste any business email. The server classifies it, evolves the schema, and stores one
        record with source evidence.
      </p>

      <div className="example-row" role="group" aria-label="Example emails">
        {demoEmailScripts.map((script) => (
          <button
            key={script.id}
            type="button"
            className="chip-button"
            title={script.description}
            onClick={() => applyScript(script.id)}
          >
            {script.label}
          </button>
        ))}
      </div>

      <form className="email-form" onSubmit={handleSubmit}>
        <div className="field-row">
          <label htmlFor="email-subject">Subject</label>
          <input
            id="email-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Optional email subject"
          />
        </div>
        <div className="field-row">
          <label htmlFor="email-body">Email body</label>
          <textarea
            id="email-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Paste a lead, support ticket, or any other business email…"
            rows={8}
          />
        </div>
        <div className="field-row field-row-split">
          <div>
            <label htmlFor="email-from">From (optional)</label>
            <input
              id="email-from"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="sender@example.com"
            />
          </div>
          <div>
            <label htmlFor="email-to">To (optional)</label>
            <input
              id="email-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="sales@magiccrm.example"
            />
          </div>
        </div>
        <button type="submit" className="primary-button" disabled={pending || body.trim() === ''}>
          {pending ? 'Ingesting…' : 'Ingest email'}
        </button>
      </form>

      {error ? <PanelError error={error} /> : null}
      {lastResult ? <IngestSummary result={lastResult} /> : null}
    </section>
  );
}

function IngestSummary({ result }: { result: IngestEmailResponse }) {
  const { schemaDelta, record } = result;
  return (
    <div className="ingest-summary" data-testid="ingest-summary">
      <p>
        {schemaDelta.tableCreated ? 'Created' : 'Updated'} table{' '}
        <strong>
          <code>{schemaDelta.table.name}</code>
        </strong>{' '}
        · {schemaDelta.newColumns.length} new{' '}
        {schemaDelta.newColumns.length === 1 ? 'column' : 'columns'} ·{' '}
        {schemaDelta.mergedColumns.length} merged{' '}
        {schemaDelta.mergedColumns.length === 1 ? 'column' : 'columns'} · revision{' '}
        {schemaDelta.schemaRevision}
      </p>
      {schemaDelta.newColumns.length > 0 ? (
        <p className="summary-columns">
          New: {schemaDelta.newColumns.map((column) => column.name).join(', ')}
        </p>
      ) : null}
      {schemaDelta.mergedColumns.length > 0 ? (
        <p className="summary-columns">
          Merged into: {schemaDelta.mergedColumns.map((column) => column.name).join(', ')}
        </p>
      ) : null}
      <p className="summary-evidence">
        Record <code>{record.id.slice(0, 8)}</code> stored; source phrases preserved as evidence.
      </p>
    </div>
  );
}
