import { NextResponse } from 'next/server';
import { validateEnv } from '@/lib/env';
import { createServiceClient } from '@/lib/auth/ownership';
import { isSupabaseConfigured } from '@/lib/db';
import { isStripeConfigured } from '@/lib/stripe/server';
import { errorMessage } from '@/lib/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 *
 * Unauthenticated, secret-free liveness/readiness probe for uptime monitors
 * and deploy checks. Reports per-component status — config (env), database
 * reachability, and payments/storage configuration — and returns 503 when a
 * critical component is down so an external monitor can alert. Never leaks
 * secret VALUES; only var names + booleans.
 */
export async function GET() {
  const env = validateEnv();

  // Database: a trivial query proves the service-role client can reach Postgres.
  let database: { ok: boolean; error?: string } = { ok: false, error: 'unconfigured' };
  if (isSupabaseConfigured()) {
    try {
      const admin = createServiceClient();
      const { error } = await admin.from('creator_profiles').select('user_id').limit(1);
      database = error ? { ok: false, error: error.message } : { ok: true };
    } catch (err) {
      database = { ok: false, error: errorMessage(err) };
    }
  }

  const components = {
    config: { ok: env.ok, missing: env.missing },
    database,
    stripe: { ok: isStripeConfigured() },
    storage: { ok: env.byGroup.storage?.ok ?? false },
    email: { ok: env.byGroup.email?.ok ?? false },
  };

  // Critical = config complete + database reachable. Stripe/storage/email are
  // reported but a config gap there is already reflected in `config.missing`.
  const ok = env.ok && database.ok;

  return NextResponse.json(
    { ok, time: new Date().toISOString(), components },
    {
      status: ok ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
