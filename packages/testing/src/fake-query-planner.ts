import type { QueryPlanOutput } from '@formless/contracts';
import type { QueryPlannerInput, QueryPlannerModel } from '@formless/core';

/**
 * Deterministic query planner keyed by the exact question text, mirroring the
 * `FakeArchitectModel`/`FakeReviewerModel` conventions. Tests pass a question
 * and receive the fixture's plan; unknown questions throw so a test never
 * silently queries with the wrong plan.
 */
export class FakeQueryPlannerModel implements QueryPlannerModel {
  constructor(private readonly cases: Record<string, QueryPlanOutput>) {}

  async plan(input: QueryPlannerInput): Promise<QueryPlanOutput> {
    const plan = this.cases[input.question];
    if (!plan) {
      throw new Error(`No fake query planner fixture for question: ${input.question}`);
    }
    return structuredClone(plan);
  }
}
