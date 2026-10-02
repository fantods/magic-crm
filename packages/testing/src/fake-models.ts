import type {
  ArchitectModel,
  ArchitectProposal,
  ReviewerDecision,
  ReviewerModel,
} from '@formless/core';
import type { NormalizedEmail } from '@formless/core';
import type { SchemaSnapshot } from '@formless/core';

export class FakeArchitectModel implements ArchitectModel {
  constructor(private readonly cases: Record<string, ArchitectProposal>) {}

  async propose(input: {
    email: NormalizedEmail;
    schema: SchemaSnapshot;
  }): Promise<ArchitectProposal> {
    const proposal = this.cases[input.email.body];
    if (!proposal) {
      throw new Error(`No fake architect fixture for email body: ${input.email.body}`);
    }
    return structuredClone(proposal);
  }
}

export class FakeReviewerModel implements ReviewerModel {
  constructor(private readonly cases: Record<string, ReviewerDecision>) {}

  async review(input: {
    email: NormalizedEmail;
    schema: SchemaSnapshot;
    proposal: ArchitectProposal;
  }): Promise<ReviewerDecision> {
    const decision = this.cases[input.email.body];
    if (!decision) {
      throw new Error(`No fake reviewer fixture for email body: ${input.email.body}`);
    }
    return structuredClone(decision);
  }
}
