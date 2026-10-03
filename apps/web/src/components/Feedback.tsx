import type { ReactNode } from 'react';
import { isMissingKeyError } from '../api/client.js';

/**
 * Shared error note. The keyless-demo case is special: the API answers 503
 * when no server-side `OPENAI_API_KEY` is configured, and the UI must make
 * that requirement obvious instead of showing a generic failure.
 */
export function PanelError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  const missingKey = isMissingKeyError(error);
  return (
    <div className={missingKey ? 'note note-key' : 'note note-error'} role="alert">
      <p>{message}</p>
      {missingKey ? (
        <p className="note-hint">
          Live model calls run on the server only. Set <code>OPENAI_API_KEY</code> in the API
          environment and restart <code>pnpm dev:api</code> — the key never reaches this browser.
        </p>
      ) : null}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p className="note" role="status">
      {label}
    </p>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
