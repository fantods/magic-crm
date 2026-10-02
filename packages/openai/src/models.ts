import { queryPlanOutputSchema, type QueryPlanOutput } from '@formless/contracts';
import {
  architectProposalSchema,
  reviewerDecisionSchema,
  type ArchitectModel,
  type ArchitectProposal,
  type NormalizedEmail,
  type QueryPlannerInput,
  type QueryPlannerModel,
  type ReviewerDecision,
  type ReviewerModel,
  type SchemaSnapshot,
} from '@formless/core';
import { buildArchitectPrompt } from './architect-prompt.js';
import { normalizeModelOutput } from './normalize-output.js';
import { buildQueryPlannerPrompt } from './query-planner-prompt.js';
import { buildReviewerPrompt, type ReviewerPolicy } from './reviewer-prompt.js';
import { OpenAiResponsesClient, type OpenAiClientOptions } from './responses-client.js';
import {
  architectProposalJsonSchema,
  queryPlanJsonSchema,
  reviewerDecisionJsonSchema,
} from './structured-schemas.js';

/**
 * Parses and normalizes raw architect output against the shared Zod contract.
 * Strict-mode structured output arrives with explicit nulls for optional
 * fields; the normalizer converts that to the contract's optional shape
 * before validation, and unknown keys are stripped by the parse.
 */
export function parseArchitectProposal(raw: unknown): ArchitectProposal {
  return architectProposalSchema.parse(normalizeModelOutput(architectProposalSchema, raw));
}

/** Parses and normalizes raw reviewer output against the shared Zod contract. */
export function parseReviewerDecision(raw: unknown): ReviewerDecision {
  return reviewerDecisionSchema.parse(normalizeModelOutput(reviewerDecisionSchema, raw));
}

/** Parses and normalizes raw query planner output against the shared Zod contract. */
export function parseQueryPlanOutput(raw: unknown): QueryPlanOutput {
  return queryPlanOutputSchema.parse(normalizeModelOutput(queryPlanOutputSchema, raw));
}

/**
 * OpenAI-backed architect implementing the same `ArchitectModel` interface as
 * the deterministic `FakeArchitectModel`, so the ingestion pipeline and its
 * tests can swap implementations without touching domain code.
 *
 * Only `apps/api` and this package may read the OpenAI key; constructing this
 * class is therefore server-side only.
 */
export class OpenAiArchitectModel implements ArchitectModel {
  private readonly client: OpenAiResponsesClient;

  constructor(options: OpenAiClientOptions) {
    this.client = new OpenAiResponsesClient(options);
  }

  async propose(input: {
    email: NormalizedEmail;
    schema: SchemaSnapshot;
  }): Promise<ArchitectProposal> {
    const prompt = buildArchitectPrompt(input);
    const result = await this.client.callStructuredOutput({
      purpose: 'architect_proposal',
      systemPrompt: prompt.systemPrompt,
      userContent: prompt.userContent,
      schemaName: 'architect_proposal',
      jsonSchema: architectProposalJsonSchema,
      parse: parseArchitectProposal,
    });
    return result.output;
  }
}

/**
 * OpenAI-backed reviewer implementing the same `ReviewerModel` interface as
 * the deterministic `FakeReviewerModel`. An optional standing policy (rules
 * and precedent examples) is appended to the prompt.
 */
export class OpenAiReviewerModel implements ReviewerModel {
  private readonly client: OpenAiResponsesClient;
  private readonly policy: ReviewerPolicy;

  constructor(options: OpenAiClientOptions & { readonly policy?: ReviewerPolicy }) {
    const { policy, ...clientOptions } = options;
    this.client = new OpenAiResponsesClient(clientOptions);
    this.policy = policy ?? {};
  }

  async review(input: {
    email: NormalizedEmail;
    schema: SchemaSnapshot;
    proposal: ArchitectProposal;
  }): Promise<ReviewerDecision> {
    const prompt = buildReviewerPrompt(input, this.policy);
    const result = await this.client.callStructuredOutput({
      purpose: 'reviewer_decision',
      systemPrompt: prompt.systemPrompt,
      userContent: prompt.userContent,
      schemaName: 'reviewer_decision',
      jsonSchema: reviewerDecisionJsonSchema,
      parse: parseReviewerDecision,
    });
    return result.output;
  }
}

/**
 * OpenAI-backed query planner implementing the same `QueryPlannerModel`
 * interface as the deterministic `FakeQueryPlannerModel`, so the query engine
 * and its tests can swap implementations without touching domain code. The
 * model emits a structured query (never SQL); the workspace is injected by the
 * server after the call, so the model cannot influence workspace isolation.
 */
export class OpenAiQueryPlannerModel implements QueryPlannerModel {
  private readonly client: OpenAiResponsesClient;

  constructor(options: OpenAiClientOptions) {
    this.client = new OpenAiResponsesClient(options);
  }

  async plan(input: QueryPlannerInput): Promise<QueryPlanOutput> {
    const prompt = buildQueryPlannerPrompt(input);
    const result = await this.client.callStructuredOutput({
      purpose: 'query_planning',
      systemPrompt: prompt.systemPrompt,
      userContent: prompt.userContent,
      schemaName: 'query_plan',
      jsonSchema: queryPlanJsonSchema,
      parse: parseQueryPlanOutput,
    });
    return result.output;
  }
}
