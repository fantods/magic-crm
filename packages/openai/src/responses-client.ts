import type { JsonSchema } from './structured-schemas.js';
import { isTransientFailureKind, ModelCallFailure, type ModelCallPurpose } from './errors.js';

/**
 * Operational metadata for one logical model call. Contains no email content:
 * bodies are only ever sent to OpenAI, never logged.
 */
export interface ModelCallMetadata {
  readonly purpose: ModelCallPurpose;
  readonly model: string;
  readonly attempts: number;
  readonly latencyMs: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly reasoningTokens?: number;
  readonly requestId?: string;
  readonly responseId?: string;
}

export interface RetryPolicy {
  /** Total attempts, including the first one. */
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffFactor: number;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 250,
  maxDelayMs: 4_000,
  backoffFactor: 2,
};

export const DEFAULT_OPENAI_MODEL = 'gpt-5.1';
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_RETRY_AFTER_MS = 30_000;

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

export interface FetchInitLike {
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal?: AbortSignal;
}

export interface FetchResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type SleepLike = (ms: number) => Promise<void>;

export interface OpenAiClientOptions {
  readonly apiKey: string;
  /** Defaults to {@link DEFAULT_OPENAI_MODEL} (`gpt-5.1`); override with `OPENAI_MODEL`. */
  readonly model?: string;
  readonly baseUrl?: string;
  /** Per-attempt timeout. */
  readonly timeoutMs?: number;
  readonly retry?: Partial<RetryPolicy>;
  /** Whether OpenAI may store the response; defaults to false (privacy-forward). */
  readonly storeResponses?: boolean;
  readonly fetch?: FetchLike;
  readonly sleep?: SleepLike;
  readonly now?: () => number;
  /** Observes successful calls' metadata for structured operational logging. */
  readonly onCall?: (metadata: ModelCallMetadata) => void;
}

export interface StructuredOutputRequest<T> {
  readonly purpose: ModelCallPurpose;
  readonly systemPrompt: string;
  readonly userContent: string;
  readonly schemaName: string;
  readonly jsonSchema: JsonSchema;
  /** Validates and normalizes the parsed model output; throws on invalid output. */
  readonly parse: (raw: unknown) => T;
}

export interface StructuredOutputResult<T> {
  readonly output: T;
  readonly metadata: ModelCallMetadata;
}

interface WireOutputTextPart {
  readonly type?: unknown;
  readonly text?: unknown;
}

interface WireOutputMessage {
  readonly type?: unknown;
  readonly content?: unknown;
}

interface WireResponse {
  readonly id?: unknown;
  readonly status?: unknown;
  readonly output?: unknown;
  readonly usage?: {
    readonly input_tokens?: unknown;
    readonly output_tokens?: unknown;
    readonly total_tokens?: unknown;
    readonly output_tokens_details?: { readonly reasoning_tokens?: unknown };
  };
  readonly error?: { readonly message?: unknown; readonly code?: unknown };
}

interface WireErrorBody {
  readonly error?: { readonly message?: unknown; readonly code?: unknown };
}

type AttemptOutcome =
  | { readonly type: 'transport'; readonly failureKind: 'network' | 'timeout' }
  | {
      readonly type: 'http';
      readonly failureKind: 'timeout' | 'rate_limited' | 'server' | 'invalid_request';
      readonly status: number;
      readonly providerMessage?: string;
      readonly providerCode?: string;
      readonly retryAfterMs?: number;
      readonly requestId?: string;
    }
  | { readonly type: 'success'; readonly payload: WireResponse; readonly requestId?: string };

/**
 * Thin adapter over the OpenAI Responses API with strict structured outputs.
 *
 * Failure handling: every provider, transport, and output error surfaces as a
 * {@link ModelCallFailure} with a normalized kind. Only transient failures
 * (`network`, `timeout`, `rate_limited`, `server`) are retried, at most
 * `retry.maxAttempts` times with exponential backoff (honoring `Retry-After`
 * for rate limits). Everything else — invalid requests and schema-invalid
 * model output — fails immediately.
 *
 * Retry safety: this client must only be invoked before any database mutation
 * begins. The ingestion pipeline calls it while planning, strictly before the
 * write transaction starts, so no retry can ever follow a mutation.
 */
export class OpenAiResponsesClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly retry: RetryPolicy;
  private readonly storeResponses: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: SleepLike;
  private readonly now: () => number;
  private readonly onCall: ((metadata: ModelCallMetadata) => void) | undefined;

  constructor(options: OpenAiClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_OPENAI_MODEL;
    this.baseUrl = (options.baseUrl ?? DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retry = { ...defaultRetryPolicy, ...options.retry };
    this.storeResponses = options.storeResponses ?? false;
    this.fetchImpl = options.fetch ?? ((url, init) => fetch(url, init as unknown as RequestInit));
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.onCall = options.onCall;
  }

  async callStructuredOutput<T>(
    request: StructuredOutputRequest<T>,
  ): Promise<StructuredOutputResult<T>> {
    const startedAt = this.now();
    const requestBody = JSON.stringify({
      model: this.model,
      input: [
        { role: 'system', content: request.systemPrompt },
        { role: 'user', content: request.userContent },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: request.schemaName,
          strict: true,
          schema: request.jsonSchema,
        },
      },
      store: this.storeResponses,
    });

    let attempt = 0;

    for (;;) {
      attempt += 1;
      const outcome = await this.attemptOnce(requestBody);

      if (outcome.type === 'success') {
        return this.parseSuccess(request, outcome, attempt, startedAt);
      }

      if (!isTransientFailureKind(outcome.failureKind) || attempt >= this.retry.maxAttempts) {
        throw new ModelCallFailure(
          {
            kind: outcome.failureKind,
            purpose: request.purpose,
            model: this.model,
            attempts: attempt,
            latencyMs: this.now() - startedAt,
            ...(outcome.type === 'http' ? { status: outcome.status } : {}),
            ...(outcome.type === 'http' && outcome.providerCode !== undefined
              ? { providerCode: outcome.providerCode }
              : {}),
            ...(outcome.type === 'http' && outcome.requestId !== undefined
              ? { requestId: outcome.requestId }
              : {}),
          },
          outcome.type === 'http' ? outcome.providerMessage : undefined,
        );
      }

      await this.sleep(this.backoffDelayMs(outcome, attempt));
    }
  }

  private parseSuccess<T>(
    request: StructuredOutputRequest<T>,
    outcome: Extract<AttemptOutcome, { readonly type: 'success' }>,
    attempt: number,
    startedAt: number,
  ): StructuredOutputResult<T> {
    const payload = outcome.payload;

    if (payload.status !== 'completed') {
      const detail = typeof payload.error?.message === 'string' ? payload.error.message : undefined;
      throw this.outputFailure(
        request,
        attempt,
        startedAt,
        detail,
        `response status was ${String(payload.status)}`,
      );
    }

    const text = extractOutputText(payload);
    if (text === undefined) {
      throw this.outputFailure(
        request,
        attempt,
        startedAt,
        undefined,
        'response had no output text',
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw this.outputFailure(request, attempt, startedAt, undefined, 'output was not valid JSON');
    }

    let output: T;
    try {
      output = request.parse(parsed);
    } catch (error) {
      throw this.outputFailure(
        request,
        attempt,
        startedAt,
        undefined,
        `schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const usage = payload.usage;
    const inputTokens = readTokenCount(usage?.input_tokens);
    const outputTokens = readTokenCount(usage?.output_tokens);
    const totalTokens = readTokenCount(usage?.total_tokens);
    const reasoningTokens = readTokenCount(usage?.output_tokens_details?.reasoning_tokens);
    const metadata: ModelCallMetadata = {
      purpose: request.purpose,
      model: this.model,
      attempts: attempt,
      latencyMs: this.now() - startedAt,
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(totalTokens === undefined ? {} : { totalTokens }),
      ...(reasoningTokens === undefined ? {} : { reasoningTokens }),
      ...(outcome.requestId === undefined ? {} : { requestId: outcome.requestId }),
      ...(typeof payload.id === 'string' ? { responseId: payload.id } : {}),
    };
    this.onCall?.(metadata);

    return { output, metadata };
  }

  private outputFailure<T>(
    request: StructuredOutputRequest<T>,
    attempt: number,
    startedAt: number,
    providerMessage: string | undefined,
    reason: string,
  ): ModelCallFailure {
    return new ModelCallFailure(
      {
        kind: 'invalid_output',
        purpose: request.purpose,
        model: this.model,
        attempts: attempt,
        latencyMs: this.now() - startedAt,
      },
      providerMessage === undefined ? reason : `${reason} (${providerMessage})`,
    );
  }

  private async attemptOnce(requestBody: string): Promise<AttemptOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
        signal: controller.signal,
      });
      const requestId = readHeader(response.headers, 'x-request-id');

      const bodyText = await response.text().catch(() => undefined as string | undefined);

      if (response.status < 200 || response.status >= 300) {
        return httpFailure(response, bodyText, requestId);
      }

      let payload: WireResponse;
      try {
        payload = JSON.parse(bodyText ?? '') as WireResponse;
      } catch {
        // A 2xx response with an unparseable body is almost always an
        // intermediary (proxy, gateway) speaking non-JSON: transient.
        return {
          type: 'http',
          failureKind: 'server',
          status: response.status,
          ...(requestId === undefined ? {} : { requestId }),
        };
      }
      return { type: 'success', payload, ...(requestId === undefined ? {} : { requestId }) };
    } catch (error) {
      const failureKind = isAbortError(error) ? 'timeout' : 'network';
      return { type: 'transport', failureKind };
    } finally {
      clearTimeout(timer);
    }
  }

  private backoffDelayMs(failure: AttemptOutcome, failedAttempt: number): number {
    if (failure.type === 'http' && failure.retryAfterMs !== undefined) {
      return Math.min(Math.max(failure.retryAfterMs, 0), MAX_RETRY_AFTER_MS);
    }
    const exponent = failedAttempt - 1;
    const raw = this.retry.initialDelayMs * this.retry.backoffFactor ** exponent;
    return Math.min(this.retry.maxDelayMs, Math.round(raw));
  }
}

function httpFailure(
  response: FetchResponseLike,
  bodyText: string | undefined,
  requestId?: string,
): AttemptOutcome {
  const failureKind =
    response.status === 408
      ? ('timeout' as const)
      : response.status === 429
        ? ('rate_limited' as const)
        : response.status >= 500
          ? ('server' as const)
          : ('invalid_request' as const);

  let providerMessage: string | undefined;
  let providerCode: string | undefined;
  let retryAfterMs: number | undefined;

  if (bodyText !== undefined) {
    try {
      const parsed = JSON.parse(bodyText) as WireErrorBody;
      if (typeof parsed.error?.message === 'string') {
        providerMessage = parsed.error.message;
      }
      if (typeof parsed.error?.code === 'string') {
        providerCode = parsed.error.code;
      }
    } catch {
      // Non-JSON error body (for example an HTML error page); keep defaults.
    }
  }

  if (failureKind === 'rate_limited') {
    const retryAfterHeader = readHeader(response.headers, 'retry-after');
    const seconds = retryAfterHeader === undefined ? Number.NaN : Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) {
      retryAfterMs = seconds * 1_000;
    }
  }

  return {
    type: 'http',
    failureKind,
    status: response.status,
    ...(providerMessage === undefined ? {} : { providerMessage }),
    ...(providerCode === undefined ? {} : { providerCode }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    ...(requestId === undefined ? {} : { requestId }),
  };
}

function extractOutputText(payload: WireResponse): string | undefined {
  if (!Array.isArray(payload.output)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of payload.output) {
    const message = item as WireOutputMessage;
    if (message.type !== 'message' || !Array.isArray(message.content)) {
      continue;
    }
    for (const part of message.content) {
      const textPart = part as WireOutputTextPart;
      if (textPart.type === 'output_text' && typeof textPart.text === 'string') {
        parts.push(textPart.text);
      }
    }
  }
  return parts.length === 0 ? undefined : parts.join('');
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function readHeader(
  headers: { get(name: string): string | null },
  name: string,
): string | undefined {
  const value = headers.get(name);
  if (value === null) {
    return undefined;
  }
  const first = value.split(',')[0]?.trim();
  return first === undefined || first.length === 0 ? undefined : first;
}

function readTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
