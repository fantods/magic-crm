import { OpenAiConfigError } from './errors.js';
import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  type OpenAiClientOptions,
} from './responses-client.js';

/**
 * Server-side OpenAI configuration.
 *
 * The key is read from the environment here (or supplied explicitly) and only
 * inside `packages/openai` and `apps/api`. It is never returned to clients or
 * imported by the web app.
 */

export interface OpenAiConfig {
  readonly apiKey: string;
  /** Defaults to `gpt-5.1`; configurable through `OPENAI_MODEL`. */
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
}

export type EnvironmentVariables = Record<string, string | undefined>;

export function resolveOpenAiConfig(env: EnvironmentVariables = process.env): OpenAiConfig {
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) {
    throw new OpenAiConfigError(
      'OPENAI_API_KEY is not set. Provide the server-side OpenAI key in the apps/api environment; it must never reach the browser.',
    );
  }

  const model = env.OPENAI_MODEL?.trim();
  const baseUrl = env.OPENAI_BASE_URL?.trim();
  const timeoutRaw = env.OPENAI_TIMEOUT_MS?.trim();

  let timeoutMs: number | undefined;
  if (timeoutRaw !== undefined && timeoutRaw.length > 0) {
    timeoutMs = Number(timeoutRaw);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new OpenAiConfigError(`Invalid OPENAI_TIMEOUT_MS: ${timeoutRaw}`);
    }
  }

  return {
    apiKey,
    model: model === undefined || model.length === 0 ? DEFAULT_OPENAI_MODEL : model,
    ...(baseUrl === undefined || baseUrl.length === 0 ? {} : { baseUrl }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  };
}

/** Builds client options from resolved configuration plus call-site extras. */
export function openAiClientOptions(
  config: OpenAiConfig,
  extra: Partial<OpenAiClientOptions> = {},
): OpenAiClientOptions {
  return {
    apiKey: config.apiKey,
    model: config.model,
    ...(config.baseUrl === undefined
      ? { baseUrl: DEFAULT_OPENAI_BASE_URL }
      : { baseUrl: config.baseUrl }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    ...extra,
  };
}
