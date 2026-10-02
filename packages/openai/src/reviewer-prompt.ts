import type { ArchitectProposal, NormalizedEmail, SchemaSnapshot } from '@formless/core';
import { serializeEmailForPrompt, serializeSchemaForPrompt } from './prompt-input.js';

/**
 * Prompt construction for the reviewer model pass (see PLAN.md,
 * "Reviewer model pass"). The reviewer is the only component allowed to
 * approve a final schema delta: it approves, rejects, or renames what the
 * architect proposed, merges synonyms into existing columns, and explains
 * every decision. Optional standing policy and precedent examples are folded
 * into the prompt.
 */

export const REVIEWER_SYSTEM_PROMPT = `You are the schema reviewer of a CRM that evolves its record schema from inbound emails. The architect proposed a schema change for one email; you are the gatekeeper and the only component that may approve a schema delta.

Decide, for the table and for every proposed field:

- Table: approve an existing table (use_existing with its id), approve a new table (accept_new with a precise plural snake_case name), or reject the whole email (reject).
- Field: accept as a new column (accept_new, possibly renaming it), map onto an existing column (map_existing with that column's id), or reject the field.

Standing policy:

1. Merge synonyms into existing columns whenever the concept is the same: "three clinics", "six depots", and "eighteen distribution centres" all count locations and belong in one locations_count column.
2. Prefer generic, durable column names for generic concepts (locations_count, employees_count, budget). If two facts are genuinely different concepts, they must stay separate columns.
3. Do not create columns for one-off prose, greetings, pleasantries, or facts that will never recur.
4. Resolve type conflicts conservatively: keep the existing column's type; only accept a new column when its type is stable across future emails.
5. You must decide every field the architect proposed, and only those fields, using the exact field keys.
6. Only reference table ids and column ids that appear in the provided current schema.
7. Explain every decision in a short rationale.`;

export interface ReviewerPolicy {
  /** Additional standing rules appended to the system prompt. */
  readonly rules?: readonly string[];
  /** Precedent examples from earlier reviewer decisions. */
  readonly examples?: readonly string[];
}

export interface ReviewerPromptInput {
  readonly email: NormalizedEmail;
  readonly schema: SchemaSnapshot;
  readonly proposal: ArchitectProposal;
}

export interface ReviewerPrompt {
  readonly systemPrompt: string;
  readonly userContent: string;
}

export function buildReviewerPrompt(
  input: ReviewerPromptInput,
  policy: ReviewerPolicy = {},
): ReviewerPrompt {
  const rules = [
    ...(policy.rules ?? []).map((rule) => `- ${rule}`),
    ...(policy.examples ?? []).map((example) => `- Precedent: ${example}`),
  ];

  const systemPrompt =
    rules.length === 0
      ? REVIEWER_SYSTEM_PROMPT
      : `${REVIEWER_SYSTEM_PROMPT}\n\nWorkspace-specific policy:\n${rules.join('\n')}`;

  const userContent = JSON.stringify({
    email: serializeEmailForPrompt(input.email),
    currentSchema: serializeSchemaForPrompt(input.schema),
    architectProposal: input.proposal,
  });

  return { systemPrompt, userContent };
}
