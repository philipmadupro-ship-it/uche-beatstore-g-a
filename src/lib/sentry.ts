/**
 * Sentry adapter — registers Sentry as the observability reporter, but only
 * when `@sentry/nextjs` is installed AND a DSN is set. Both are optional so
 * the app builds and runs without the package; installing it + setting the
 * DSN is all it takes to light up every existing `captureException` call.
 *
 * To activate:
 *   1. npm install @sentry/nextjs
 *   2. set SENTRY_DSN (server) and/or NEXT_PUBLIC_SENTRY_DSN (client)
 *   3. (optional, for source maps) wrap next.config with withSentryConfig
 *
 * The dynamic import is hidden from the bundler so missing optional package
 * warnings do not pollute local dev/build logs when a DSN is present.
 */
import { setReporter } from '@/lib/observability';

let initialized = false;

type OptionalSentry = {
  init: (options: {
    dsn: string;
    environment?: string;
    tracesSampleRate: number;
  }) => void;
  captureException: (error: unknown, context?: { extra: Record<string, unknown> }) => void;
  captureMessage: (message: string, context?: { extra: Record<string, unknown> }) => void;
};

function importOptionalSentry(): Promise<OptionalSentry> {
  const runtimeImport = new Function('specifier', 'return import(specifier)') as (
    specifier: string,
  ) => Promise<OptionalSentry>;
  return runtimeImport('@sentry/nextjs');
}

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  initialized = true;

  try {
    const Sentry = await importOptionalSentry();

    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV,
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    });

    setReporter({
      captureException: (error, context) =>
        Sentry.captureException(error, context ? { extra: context } : undefined),
      captureMessage: (message, context) =>
        Sentry.captureMessage(message, context ? { extra: context } : undefined),
    });
  } catch {
    // @sentry/nextjs not installed — stay on the no-op reporter.
    initialized = false;
  }
}
