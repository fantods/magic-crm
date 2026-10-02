import type { ArchitectModel, QueryPlannerModel, ReviewerModel } from '@formless/core';
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

/**
 * Builds the real OpenAI-backed model set from server-side environment
 * configuration. Throws `OpenAiConfigError` when `OPENAI_API_KEY` is absent,
 * so callers decide how to degrade (the API answers ingestion and query
 * requests with 503 until the key is configured).
 */
export function createOpenAiModels(env: EnvironmentVariables = process.env): ApiModels {
  const config = resolveOpenAiConfig(env);
  const clientOptions = openAiClientOptions(config);

  return {
    architect: new OpenAiArchitectModel(clientOptions),
    reviewer: new OpenAiReviewerModel(clientOptions),
    planner: new OpenAiQueryPlannerModel(clientOptions),
    label: `openai:${config.model}`,
  };
}
