import { NextResponse } from 'next/server';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('api.public-error');

/**
 * Generic error response for PUBLIC / untrusted-facing routes.
 *
 * Returning `errorMessage(err)` straight to an anonymous caller leaks the
 * underlying error string — for a Supabase/Postgres error that can include
 * column or constraint names (schema-info disclosure). This logs the real
 * detail server-side (full diagnostics retained) but returns a generic message
 * to the client.
 *
 * Use on public routes (store/share/etc.). Dashboard routes may still surface
 * `errorMessage(err)` since the caller is the authenticated owner.
 */
export function publicError(err: unknown, status = 500): NextResponse {
  log.error('public route failed', { error: errorMessage(err), status });
  return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status });
}
