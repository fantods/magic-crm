import type { NormalizedEmail, SchemaSnapshot } from '@formless/core';
import { serializeEmailForPrompt, serializeSchemaForPrompt } from './prompt-input.js';

/**
 * Prompt construction for the architect model pass (see PLAN.md,
 * "Architect model pass"). The architect reads the normalized email and the
 * current workspace schema, then proposes a table target and field values.
 * It never mutates the database; its output is only a proposal.
 */

export const ARCHITECT_SYSTEM_PROMPT = `You are the schema architect of a CRM that evolves its record schema from inbound emails.

You receive one normalized email and the workspace's current logical schema (tables and columns with types, aliases, and units). Your job:

1. Classify the email as belonging to exactly one existing table (reference it by id) or propose exactly one new table when no existing table fits.
2. Map every extractable durable fact to an existing column where a semantic match exists (by name or alias): reuse that column's exact name or one of its aliases as columnName. Only when no existing column semantically matches the fact do you propose a new column name.
3. Do not invent columns for one-off prose, greetings, or signature noise.
4. Choose a conservative canonical type from the allowed set: text, integer, decimal, boolean, date (YYYY-MM-DD), datetime (ISO 8601), enum, email, url, json. Prefer the narrowest type that fits every likely future value. For enum columns, list the allowed values in enumValues.
5. Extract evidence for every field: an exact quote of the phrase from the email, with source being one of "subject", "body", "from", "to". The quote must appear verbatim (case-insensitive) in that part of the email, or the field will be rejected. startIndex/endIndex are optional.

Naming: field keys are stable snake_case identifiers; column names are human-readable but concise. Every field requires a short rationale.

One email produces one primary record: facts about secondary entities mentioned in the email become fields of the one record, not separate tables.`;

export interface ArchitectPromptInput {
  readonly email: NormalizedEmail;
  readonly schema: SchemaSnapshot;
}

export interface ArchitectPrompt {
  readonly systemPrompt: string;
  readonly userContent: string;
}

export function buildArchitectPrompt(input: ArchitectPromptInput): ArchitectPrompt {
  const userContent = JSON.stringify({
    email: serializeEmailForPrompt(input.email),
    currentSchema: serializeSchemaForPrompt(input.schema),
  });

  return { systemPrompt: ARCHITECT_SYSTEM_PROMPT, userContent };
}
