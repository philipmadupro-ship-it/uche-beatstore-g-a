/**
 * Provider-agnostic error reporting.
 *
 * App code (route catches, `createLogger().error`) calls `captureException`
 * here instead of importing Sentry directly. A reporter is registered at
 * startup (`initSentry` in instrumentation) when a DSN is configured;
 * until then every call is a safe no-op. This keeps Sentry an optional,
 * swappable edge dependency — the codebase never hard-depends on it.
 */

export interface Reporter {
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  captureMessage?: (message: string, context?: Record<string, unknown>) => void;
}

let reporter: Reporter | null = null;

/** Register the active error reporter (e.g. Sentry). Last writer wins. */
export function setReporter(r: Reporter | null): void {
  reporter = r;
}

export function hasReporter(): boolean {
  return reporter != null;
}

/** Report an exception to whatever reporter is registered. Never throws. */
export function captureException(error: unknown, context?: Record<string, unknown>): void {
  try {
    reporter?.captureException(error, context);
  } catch {
    // a reporting failure must never break the request path
  }
}

/** Report a message-level event (warnings, notable states). Never throws. */
export function captureMessage(message: string, context?: Record<string, unknown>): void {
  try {
    reporter?.captureMessage?.(message, context);
  } catch {
    /* swallow */
  }
}
