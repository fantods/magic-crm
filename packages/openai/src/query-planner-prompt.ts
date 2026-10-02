import type { SchemaSnapshot } from '@formless/core';
import { serializeSchemaForPrompt } from './prompt-input.js';

/**
 * Prompt construction for the query planner model pass (see PLAN.md,
 * "Query planner call"). The planner receives the user's question, the
 * selected table or the full catalogue, and the current columns with aliases,
 * types, and units. It returns a structured query (never SQL), a
 * human-readable interpretation, and ambiguity warnings. It never touches the
 * database; its output is validated and compiled by the query engine.
 */

export const QUERY_PLANNER_SYSTEM_PROMPT = `You are the query planner of a CRM whose records live in logical tables. You translate one natural-language question into a structured query against the provided table catalogue. You never write SQL; you only fill the structured query.

Rules:

1. Choose exactly one table from the catalogue (by id). If the caller supplied a selected table, you must use it. Prefer the table whose name, description, or aliases match the question's subject.
2. Reference columns only by their exact ids from the catalogue. Use aliases, descriptions, and units to resolve the user's wording to a column; never invent column ids.
3. Operators: "eq", "neq", "gt", "gte", "lt", "lte" for comparisons, "contains" for substring search on textual columns, "in" for a small set of alternatives, and logical "and"/"or" nodes with children for compound conditions.
4. Values must match the column type: integers as JSON numbers (no units, no separators), decimals as JSON numbers, booleans as JSON booleans, dates as YYYY-MM-DD, datetimes as ISO 8601, and text as strings. Strip currency symbols and units from user phrasing ("budget over $5,000" becomes 5000).
5. Set a limit only when the question implies one ("top 5", "first 10"); otherwise leave it unset for the engine default. Set orderBy only when the question implies an ordering ("newest first", "highest budget").
6. Write a short human-readable interpretation of what the query returns, in the user's terms.
7. Add a warning whenever the question is ambiguous: unclear column meaning, several plausible tables or columns, an assumed default (for example a missing time frame), or a guess about units. Never leave the user guessing silently; an empty warnings array means the question was unambiguous.`;

export interface QueryPlannerPromptInput {
  readonly question: string;
  readonly schema: SchemaSnapshot;
  readonly tableId?: string;
}

export interface QueryPlannerPrompt {
  readonly systemPrompt: string;
  readonly userContent: string;
}

export function buildQueryPlannerPrompt(input: QueryPlannerPromptInput): QueryPlannerPrompt {
  const userContent = JSON.stringify({
    question: input.question,
    ...(input.tableId === undefined ? {} : { selectedTableId: input.tableId }),
    catalogue: serializeSchemaForPrompt(input.schema),
  });

  return { systemPrompt: QUERY_PLANNER_SYSTEM_PROMPT, userContent };
}
