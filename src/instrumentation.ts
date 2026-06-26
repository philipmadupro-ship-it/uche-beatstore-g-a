/**
 * Runs once when the server boots (Next.js instrumentation hook).
 *
 * We use it as the env-config gate: if a production deploy is missing required
 * environment variables, that should be screamingly obvious in the boot logs
 * rather than surfacing later as a confusing 500 deep in a checkout. We log a
 * loud banner (and the missing list) instead of hard-throwing so a single
 * missing var can't crash-loop the whole deployment during rollout — uptime
 * monitors catch the matching 503 from GET /api/health. Flip to `assertEnv()`
 * if you want boot to hard-fail instead.
 */
export async function register() {
  // Only the Node.js server runtime has process.env fully populated.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  // Register the error reporter (Sentry, if installed + DSN set) so every
  // captureException across the app starts flowing. No-op otherwise.
  const { initSentry } = await import('@/lib/sentry');
  await initSentry();

  const { validateEnv } = await import('@/lib/env');
  const report = validateEnv();
  if (!report.ok && process.env.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.error(
      `\n🛑 [env] Missing required environment variables — the app will misbehave:\n` +
        report.missing.map((v) => `   • ${v}`).join('\n') +
        `\n   See REQUIRED_ENV in src/lib/env.ts. /api/health will report 503.\n`,
    );
  }
}
