import type { EmailIngestionInput } from '@formless/contracts';
import {
  architectProposalSchema,
  reviewerDecisionSchema,
  type ArchitectProposal,
  type ReviewerDecision,
} from './model-contracts.js';
import { calculateIngestionPlan, type IdGenerator, type IngestionPlan } from './ingestion-plan.js';
import { normalizeEmail, type NormalizedEmail } from './normalize-email.js';
import type { SchemaSnapshot } from './schema-snapshot.js';

export interface ArchitectModel {
  propose(input: { email: NormalizedEmail; schema: SchemaSnapshot }): Promise<ArchitectProposal>;
}

export interface ReviewerModel {
  review(input: {
    email: NormalizedEmail;
    schema: SchemaSnapshot;
    proposal: ArchitectProposal;
  }): Promise<ReviewerDecision>;
}

export interface PlannedIngestion {
  readonly email: NormalizedEmail;
  readonly proposal: ArchitectProposal;
  readonly decision: ReviewerDecision;
  readonly plan: IngestionPlan;
}

export class IngestionPlanner {
  constructor(
    private readonly architect: ArchitectModel,
    private readonly reviewer: ReviewerModel,
    private readonly generateId: IdGenerator,
  ) {}

  async plan(
    input: EmailIngestionInput,
    schema: SchemaSnapshot,
    currentSchemaRevision = 0,
  ): Promise<PlannedIngestion> {
    const email = normalizeEmail(input);
    const proposal = architectProposalSchema.parse(await this.architect.propose({ email, schema }));
    const decision = reviewerDecisionSchema.parse(
      await this.reviewer.review({ email, schema, proposal }),
    );
    const plan = calculateIngestionPlan({
      email,
      schema,
      proposal,
      decision,
      currentSchemaRevision: currentSchemaRevision,
      generateId: this.generateId,
    });

    return { email, proposal, decision, plan };
  }
}
