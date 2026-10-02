/**
 * Normalized failures for OpenAI model calls.
 *
 * Every provider error (HTTP error bodies), transport error (fetch rejections,
 * aborts), and malformed-output error is mapped onto {@link ModelCallFailure}
 * before it escapes this package, so the API layer and application code never
 * see raw provider/network exception shapes.
 *
 * Failure messages must never contain email content: provider messages are
 * truncated and flattened so an echoed email body can never be logged whole.
 */

export type ModelCallPurpose = 'architect_proposal' | 'reviewer_decision' | 'query_planning';

export type ModelFailureKind =
  /** The transport layer rejected the request before a response (DNS, TLS, connection reset). */
  | 'network'
  /** The per-attempt timeout elapsed before a response completed. */
  | 'timeout'
  /** OpenAI rate limited the request (HTTP 429). Transient; retried with backoff. */
  | 'rate_limited'
  /** OpenAI or an intermediary returned a transient server error (408, 5xx). */
  | 'server'
  /** The request was rejected by OpenAI and must not be retried (other 4xx). */
  | 'invalid_request'
  /** A completed response did not contain schema-valid structured output. */
  | 'invalid_output';

const TRANSIENT_KINDS: ReadonlySet<ModelFailureKind> = new Set([
  'network',
  'timeout',
  'rate_limited',
  'server',
]);

export function isTransientFailureKind(kind: ModelFailureKind): boolean {
  return TRANSIENT_KINDS.has(kind);
}

export interface ModelCallFailureDetails {
  readonly kind: ModelFailureKind;
  readonly purpose: ModelCallPurpose;
  readonly model: string;
  /** Total attempts made, including the failed one. */
  readonly attempts: number;
  /** Total wall-clock latency across all attempts, in milliseconds. */
  readonly latencyMs: number;
  /** HTTP status code when a response was received. */
  readonly status?: number;
  /** OpenAI error code, when the provider supplied one (for example `context_length_exceeded`). */
  readonly providerCode?: string;
  /** OpenAI request ID (`x-request-id` header), when available. */
  readonly requestId?: string;
}

function sanitizeDetail(value: string | undefined, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const flattened = value.replace(/\s+/g, ' ').trim();
  if (flattened.length === 0) {
    return undefined;
  }
  return flattened.length <= maxLength ? flattened : `${flattened.slice(0, maxLength)}…`;
}

export class ModelCallFailure extends Error {
  readonly details: ModelCallFailureDetails;

  constructor(details: ModelCallFailureDetails, providerMessage?: string) {
    const parts = [
      `OpenAI ${details.purpose} call failed (${details.kind})`,
      `model=${details.model}`,
      `attempts=${details.attempts}`,
      details.status === undefined ? undefined : `status=${details.status}`,
      details.providerCode === undefined ? undefined : `code=${details.providerCode}`,
      details.requestId === undefined ? undefined : `request_id=${details.requestId}`,
    ].filter((part): part is string => part !== undefined);

    const message = sanitizeDetail(providerMessage, 300);
    super(message === undefined ? parts.join(' ') : `${parts.join(' ')}: ${message}`);

    this.name = 'ModelCallFailure';
    this.details = details;
  }

  get kind(): ModelFailureKind {
    return this.details.kind;
  }

  get retryable(): boolean {
    return isTransientFailureKind(this.details.kind);
  }
}

/** Raised by {@link resolveOpenAiConfig} when required server configuration is missing. */
export class OpenAiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpenAiConfigError';
  }
}
