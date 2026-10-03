import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Acceptance criterion 7 (static half): no application code may update or
 * delete a schema event. The database trigger verified by
 * `migrator.integration.test.ts` enforces this at the database level; this
 * scan guards the application side by construction.
 */
const mutatingSourceFiles = [
  'repositories/schema-event-repository.ts',
  'repositories/ingestion-repository.ts',
  'repositories/record-repository.ts',
  'repositories/schema-catalog-repository.ts',
  'repositories/workspace-repository.ts',
];

describe('append-only schema journal (application side)', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));

  it('contains no UPDATE or DELETE against schema_events in application code', () => {
    for (const relativePath of mutatingSourceFiles) {
      const source = readFileSync(`${here}${relativePath}`, 'utf8');
      expect(source, `${relativePath} must not mutate schema_events`).not.toMatch(
        /update\s+schema_events|delete\s+from\s+schema_events/i,
      );
    }
  });
});
