import type { ArchitectModel, ReviewerModel } from '@formless/core';
import {
  OpenAiArchitectModel,
  OpenAiReviewerModel,
  openAiClientOptions,
  resolveOpenAiConfig,
  type EnvironmentVariables,
} from '@formless/openai';

/**
 * The model passes used by the ingestion pipeline. `label` is operational
 * metadata recorded on schema events; it never contains email content.
 */
export interface IngestionModels {
  readonly architect: ArchitectModel;
  readonly reviewer: ReviewerModel;
  readonly label: string;
}

/**
 * Builds the real OpenAI-backed model pair from server-side environment
 * configuration. Throws `OpenAiConfigError` when `OPENAI_API_KEY` is absent,
 * so callers decide how to degrade (the API answers ingestion requests with
 * 503 until the key is configured).
 */
export function createOpenAiModels(env: EnvironmentVariables = process.env): IngestionModels {
  const config = resolveOpenAiConfig(env);
  const clientOptions = openAiClientOptions(config);

  return {
    architect: new OpenAiArchitectModel(clientOptions),
    reviewer: new OpenAiReviewerModel(clientOptions),
    label: `openai:${config.model}`,
  };
}
