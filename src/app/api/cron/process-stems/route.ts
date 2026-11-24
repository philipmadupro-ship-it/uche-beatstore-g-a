import { NextRequest, NextResponse } from 'next/server';
import { isSupabaseConfigured } from '@/lib/db';
import { processStemBatch } from '@/lib/stems/pipeline';
import { defaultPipelineDeps } from '@/lib/stems/runtime';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';

const log = createLogger('cron.process-stems');
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Drives queued stem jobs and reclaims crashed ones (AUDIO-05). Idempotent:
 * a row another driver holds fails its claim and is skipped. Daily on Vercel
 * (Hobby), every 15 minutes through .github/workflows/frequent-crons.yml.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json({ skipped: 'Supabase not configured' });
  }
  try {
    const raw = Number(req.nextUrl.searchParams.get('limit') ?? 5);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 20) : 5;
    const result = await processStemBatch(defaultPipelineDeps(), { limit, budgetMs: 240_000 });
    log.info('stem batch complete', { ...result });
    return NextResponse.json(result);
  } catch (err) {
    log.error('stem batch failed', { error: errorMessage(err) });
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
