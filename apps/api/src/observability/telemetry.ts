/**
 * Error telemetry hook surface (Milestone 8).
 *
 * The demo ships with a no-op telemetry implementation: nothing leaves the
 * process, and no third-party SDK is bundled. An operator can wire their own
 * reporting backend later by calling {@link setErrorTelemetry} with an
 * implementation of {@link ErrorTelemetry} at server start-up.
 *
 * Errors handed to telemetry are described by message, name, and caller
 * context only — never by email content — matching the plan's privacy
 * decision that full email bodies are never logged.
 */
export interface ErrorTelemetryContext {
  readonly [key: string]: string | number | boolean | null | undefined;
}

export interface ErrorTelemetry {
  /** Reports one error with optional structured context (no email content). */
  captureError(error: unknown, context?: ErrorTelemetryContext): void;
}

const noopTelemetry: ErrorTelemetry = {
  captureError: () => undefined,
};

let currentTelemetry: ErrorTelemetry = noopTelemetry;

/**
 * Installs an operator-provided telemetry implementation. Passing `undefined`
 * restores the built-in no-op. Maliciously or accidentally broken hooks are
 * contained: {@link captureError} swallows anything the hook throws so
 * telemetry can never take down request handling.
 */
export function setErrorTelemetry(telemetry: ErrorTelemetry | undefined): void {
  currentTelemetry = telemetry ?? noopTelemetry;
}

/** The currently installed telemetry (the no-op by default). */
export function getErrorTelemetry(): ErrorTelemetry {
  return currentTelemetry;
}

/**
 * Safe entry point used by request handling. Never throws, never logs email
 * bodies: context values are constrained to primitives by type, and the
 * message/name pair carries no request payload.
 */
export function captureError(error: unknown, context: ErrorTelemetryContext = {}): void {
  try {
    currentTelemetry.captureError(error, context);
  } catch {
    // Telemetry must never break request handling.
  }
}
