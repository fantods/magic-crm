import type { ArchitectModel, QueryPlannerModel, ReviewerModel } from '@formless/core';
import type { ModelCallMetadata } from '@formless/openai';
import {
  OpenAiArchitectModel,
  OpenAiQueryPlannerModel,
  OpenAiReviewerModel,
  openAiClientOptions,
  resolveOpenAiConfig,
  type EnvironmentVariables,
} from '@formless/openai';

/**
 * The model passes used by the API: the ingestion pipeline's architect and
 * reviewer, and the query planner. `label` is operational metadata recorded on
 * schema events; it never contains email content.
 */
export interface ApiModels {
  readonly architect: ArchitectModel;
  readonly reviewer: ReviewerModel;
  readonly planner: QueryPlannerModel;
  readonly label: string;
}

/** Observes one completed model call's operational metadata. */
export type OnModelCall = (metadata: ModelCallMetadata) => void;

/**
 * Builds the real OpenAI-backed model set from server-side environment
 * configuration. Throws `OpenAiConfigError` when `OPENAI_API_KEY` is absent,
 * so callers decide how to degrade (the API answers ingestion and query
 * requests with 503 until the key is configured).
 *
 * `onModelCall` receives the operational metadata the adapter records for
 * every completed call (purpose, model, attempts, latency, token counts,
 * request IDs) — never email content — for structured operational logging.
 */
export function createOpenAiModels(
  env: EnvironmentVariables = process.env,
  onModelCall?: OnModelCall,
): ApiModels {
  const config = resolveOpenAiConfig(env);
  const clientOptions = openAiClientOptions(
    config,
    onModelCall === undefined ? {} : { onCall: onModelCall },
  );

  return {
    architect: new OpenAiArchitectModel(clientOptions),
    reviewer: new OpenAiReviewerModel(clientOptions),
    planner: new OpenAiQueryPlannerModel(clientOptions),
    label: `openai:${config.model}`,
  };
}
