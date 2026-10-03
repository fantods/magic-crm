import type { ModelCallMetadata } from '@formless/openai';

/**
 * Field values allowed in operational log lines. Keeping the value domain
 * narrow (and the blocklist below enforced at runtime) is the structural
 * guard behind the plan's privacy decision: full email bodies are never
 * written to application logs.
 */
export type OperationalLogValue = string | number | boolean | null;

/** Keys that must never appear in a log line, even if a caller passes them. */
const REDACTED_KEYS = new Set([
  'body',
  'emailbody',
  'normalized',
  'normalizedemail',
  'input',
  'content',
  'authorization',
  'cookie',
  'apikey',
]);

function sanitizeFields(
  fields: Record<string, OperationalLogValue | undefined>,
): Record<string, OperationalLogValue> {
  const clean: Record<string, OperationalLogValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || REDACTED_KEYS.has(key.toLowerCase())) {
      continue;
    }
    clean[key] = value;
  }
  return clean;
}

/**
 * Minimal structured logger emitting one JSON object per line.
 *
 * Operational logs carry metadata only: model purpose, latency, token counts,
 * request IDs, and route-level status. They never carry email content — the
 * field sanitizer drops redacted keys and the typed field domain keeps
 * arbitrary objects (such as request bodies) out entirely.
 */
export class OperationalLogger {
  private readonly writeLine: (line: string) => void;
  private readonly now: () => number;

  constructor(
    options: {
      writeLine?: (line: string) => void;
      now?: () => number;
    } = {},
  ) {
    this.writeLine = options.writeLine ?? ((line) => console.log(line));
    this.now = options.now ?? Date.now;
  }

  info(message: string, fields: Record<string, OperationalLogValue | undefined> = {}): void {
    this.emit('info', message, fields);
  }

  warn(message: string, fields: Record<string, OperationalLogValue | undefined> = {}): void {
    this.emit('warn', message, fields);
  }

  error(message: string, fields: Record<string, OperationalLogValue | undefined> = {}): void {
    this.emit('error', message, fields);
  }

  /** Emits the model-call operational metadata recorded by the OpenAI adapter. */
  modelCall(metadata: ModelCallMetadata): void {
    this.emit('info', 'model_call', {
      purpose: metadata.purpose,
      model: metadata.model,
      attempts: metadata.attempts,
      latency_ms: metadata.latencyMs,
      ...(metadata.inputTokens === undefined ? {} : { input_tokens: metadata.inputTokens }),
      ...(metadata.outputTokens === undefined ? {} : { output_tokens: metadata.outputTokens }),
      ...(metadata.totalTokens === undefined ? {} : { total_tokens: metadata.totalTokens }),
      ...(metadata.reasoningTokens === undefined
        ? {}
        : { reasoning_tokens: metadata.reasoningTokens }),
      ...(metadata.requestId === undefined ? {} : { request_id: metadata.requestId }),
      ...(metadata.responseId === undefined ? {} : { response_id: metadata.responseId }),
    });
  }

  private emit(
    level: 'info' | 'warn' | 'error',
    message: string,
    fields: Record<string, OperationalLogValue | undefined>,
  ): void {
    const line = JSON.stringify({
      time: new Date(this.now()).toISOString(),
      level,
      msg: message,
      ...sanitizeFields(fields),
    });
    this.writeLine(line);
  }
}

/** A logger that discards everything; the default for tests and quiet mode. */
export const silentLogger: OperationalLogger = new OperationalLogger({
  writeLine: () => undefined,
});
