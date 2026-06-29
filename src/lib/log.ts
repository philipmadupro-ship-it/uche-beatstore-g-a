/**
 * Tiny structured logger.
 *
 * In dev we render to the terminal with a route prefix so you can grep.
 * In prod we emit JSON to stdout so the host's collector can index it.
 *
 * Usage:
 *   const log = createLogger('api.tracks.rate');
 *   log.info('rated', { trackId, rating });
 *   log.warn('rate failed', { trackId, status, error });
 *
 * Why not console directly? Two reasons:
 *   1. Levels: in prod we may want to drop debug/info to reduce noise.
 *      Centralizing makes that one config change instead of grepping
 *      every console.log.
 *   2. Structure: searching prod logs for "track 123" works if every
 *      log line carries `trackId` as a field; less reliable if it's
 *      interpolated into a free-form string.
 *
 * Intentionally not pulling in pino/winston — this is ~40 lines and
 * upgrading later is a one-import swap when needed.
 */

import { captureException } from '@/lib/observability';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

const LEVEL_RANK: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

// Resolve the minimum level once at module load. Set LOG_LEVEL=debug
// while debugging a specific endpoint; defaults to `info` in prod and
// `debug` in dev.
const MIN_LEVEL: Level = (() => {
  const env = (process.env.LOG_LEVEL || '').toLowerCase();
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
})();

const IS_PROD = process.env.NODE_ENV === 'production';

function emit(level: Level, scope: string, message: string, context?: LogContext) {
  // Error-level logs feed the observability reporter (Sentry, when configured)
  // so production exceptions surface somewhere actionable — not just stdout.
  // Done before the level gate so errors always report even if logs are quiet.
  if (level === 'error') {
    captureException(new Error(`[${scope}] ${message}`), { scope, ...(context ?? {}) });
  }

  if (LEVEL_RANK[level] < LEVEL_RANK[MIN_LEVEL]) return;

  if (IS_PROD) {
    // Structured JSON — one line per event, host log collectors index it.
    const record = {
      ts: new Date().toISOString(),
      level,
      scope,
      msg: message,
      ...(context ?? {}),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
    return;
  }

  // Human-readable dev format. Color via ANSI; keeps grep-friendly.
  const tag = `[${scope}]`;
  const args: unknown[] = context ? [tag, message, context] : [tag, message];
  switch (level) {
    case 'debug':
      // eslint-disable-next-line no-console
      console.debug(...args);
      return;
    case 'info':
      // eslint-disable-next-line no-console
      console.info(...args);
      return;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(...args);
      return;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(...args);
      return;
  }
}

export interface Logger {
  debug: (msg: string, ctx?: LogContext) => void;
  info: (msg: string, ctx?: LogContext) => void;
  warn: (msg: string, ctx?: LogContext) => void;
  error: (msg: string, ctx?: LogContext) => void;
}

/**
 * Mask an email for logging — keeps the first 3 local-part chars + domain so a
 * log line stays correlatable without storing buyer PII in plaintext.
 * `buyer@example.com` → `buy***@example.com`. Use anywhere a buyer email would
 * otherwise be logged.
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '<none>';
  const at = email.indexOf('@');
  if (at < 1) return '***';
  return `${email.slice(0, Math.min(3, at))}***${email.slice(at)}`;
}

/**
 * Create a logger scoped to a route or module. Use dot-paths like
 * `api.tracks.rate` so prod grep is trivial.
 */
export function createLogger(scope: string): Logger {
  return {
    debug: (msg, ctx) => emit('debug', scope, msg, ctx),
    info: (msg, ctx) => emit('info', scope, msg, ctx),
    warn: (msg, ctx) => emit('warn', scope, msg, ctx),
    error: (msg, ctx) => emit('error', scope, msg, ctx),
  };
}
