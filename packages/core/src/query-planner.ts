import type { QueryPlanOutput } from '@formless/contracts';
import type { SchemaSnapshot } from './schema-snapshot.js';

export interface QueryPlannerInput {
  /** The user's natural-language question. */
  readonly question: string;
  /** The workspace catalogue of tables with columns, aliases, types, and units. */
  readonly schema: SchemaSnapshot;
  /** The table the user (or UI) already selected, narrowing the planner's choice. */
  readonly tableId?: string;
}

/**
 * The query planner model pass (PLAN.md, "Query planner call"). Implementations
 * turn a natural-language question into a structured `RecordQuery` (never SQL),
 * a human-readable interpretation, and any ambiguity warnings. Like the
 * architect and reviewer passes, implementations are swappable: the OpenAI
 * adapter in `@formless/openai` and the deterministic fake in
 * `@formless/testing` share this interface.
 */
export interface QueryPlannerModel {
  plan(input: QueryPlannerInput): Promise<QueryPlanOutput>;
}
