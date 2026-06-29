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
 * The dynamic import uses a non-literal specifier so TypeScript treats the
 * module as `any` and doesn't fail the build when the package isn't present.
 */
import { setReporter } from '@/lib/observability';

let initialized = false;

export async function initSentry(): Promise<void> {
  if (initialized) return;
  const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  initialized = true;

  try {
    // Non-literal specifier → optional dependency, resolved only at runtime.
    const pkg = '@sentry/nextjs';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Sentry = (await import(pkg as string)) as any;

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
