import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnvFile(path.join(process.cwd(), '.env.local'));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const configuredAppUrl = process.env.NEXT_PUBLIC_APP_URL || '';
const configuredIsLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(configuredAppUrl);
const baseUrl = (
  process.env.READINESS_BASE_URL
  || (!configuredIsLocal ? configuredAppUrl : '')
  || 'https://uche-beatstore-g.vercel.app'
).replace(/\/$/, '');

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [];
const add = (name, status, details) => checks.push({ name, status, details });
const describeError = (error) => ({
  message: error?.message || String(error || 'Unknown error'),
  code: error?.code || null,
  details: error?.details || null,
  hint: error?.hint || null,
  raw: error && typeof error === 'object' ? JSON.parse(JSON.stringify(error)) : null,
});

async function countRows(table, configure = (query) => query) {
  const query = configure(supabase.from(table).select('id', { count: 'exact', head: true }));
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

async function checkCounts() {
  try {
    const [total, listed] = await Promise.all([
      countRows('tracks'),
      countRows('tracks', (query) => query.eq('store_listed', true)),
    ]);
    add('catalogue inventory', 'pass', { totalTracks: total, listedTracks: listed });
  } catch (error) {
    add('catalogue inventory', 'fail', { error: describeError(error) });
  }

  try {
    const [pending, failed, dead] = await Promise.all([
      countRows('fulfillment_email_jobs', (query) => query.eq('status', 'pending')),
      countRows('fulfillment_email_jobs', (query) => query.eq('status', 'failed')),
      countRows('fulfillment_email_jobs', (query) => query.eq('status', 'dead')),
    ]);
    add('migration 103 email outbox', dead > 0 ? 'warn' : 'pass', { pending, failed, dead });
  } catch (error) {
    add('migration 103 email outbox', 'fail', { error: describeError(error) });
  }

  try {
    const [queued, processing, failed] = await Promise.all([
      countRows('upload_processing_jobs', (query) => query.eq('status', 'queued')),
      countRows('upload_processing_jobs', (query) => query.eq('status', 'processing')),
      countRows('upload_processing_jobs', (query) => query.eq('status', 'failed')),
    ]);
    add('upload processing queue', failed > 0 ? 'warn' : 'pass', { queued, processing, failed });
  } catch (error) {
    add('upload processing queue', 'fail', { error: describeError(error) });
  }

  try {
    const { data: legacyRows, error: legacyError } = await supabase
      .from('tracks')
      .select('id')
      .not('audio_url', 'is', null)
      .is('private_audio_migrated_at', null)
      .limit(1000);
    if (legacyError) throw legacyError;
    const legacy = legacyRows?.length ?? 0;
    add('legacy public-master backlog', legacy > 0 ? 'warn' : 'pass', {
      remaining: legacy,
      truncated: legacy === 1000,
    });
  } catch (error) {
    add('legacy public-master backlog', 'fail', { error: describeError(error) });
  }
}

function inspectForPrivateMedia(value, pathParts = [], findings = []) {
  if (typeof value === 'string') {
    if (value.startsWith('r2://') || /\.(wav|zip)(\?|$)/i.test(value)) {
      findings.push(pathParts.join('.'));
    }
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForPrivateMedia(item, [...pathParts, String(index)], findings));
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      inspectForPrivateMedia(child, [...pathParts, key], findings);
    }
  }
  return findings;
}

async function checkPublicStore() {
  const startedAt = performance.now();
  try {
    const response = await fetch(`${baseUrl}/api/store?limit=80`, {
      headers: { accept: 'application/json' },
    });
    const bodyText = await response.text();
    const elapsedMs = Math.round(performance.now() - startedAt);
    const body = JSON.parse(bodyText);
    const findings = inspectForPrivateMedia(body).slice(0, 10);
    const trackCount = Array.isArray(body.tracks) ? body.tracks.length : null;
    const hasPagination = Boolean(body.pageInfo);
    add('public store response', response.ok && findings.length === 0 && hasPagination ? 'pass' : 'fail', {
      httpStatus: response.status,
      vercelError: response.headers.get('x-vercel-error'),
      elapsedMs,
      payloadBytes: Buffer.byteLength(bodyText),
      trackCount,
      hasPagination,
      privateMediaPaths: findings,
      cacheControl: response.headers.get('cache-control'),
      responseError: typeof body?.error === 'string' ? body.error : null,
    });
  } catch (error) {
    add('public store response', 'fail', { error: describeError(error) });
  }
}

async function checkCataloguePlan() {
  try {
    const { data, error } = await supabase
      .from('tracks')
      .select('id,title,store_sort_order,created_at')
      .eq('store_listed', true)
      .order('store_sort_order', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(80)
      .explain({ analyze: false, verbose: false, format: 'json' });
    if (error) throw error;
    const planText = JSON.stringify(data);
    const usesExpectedIndex = planText.includes('idx_tracks_public_catalog_order') || planText.includes('tracks_store_sort_order_idx');
    add('migration 104 catalogue query plan', usesExpectedIndex ? 'pass' : 'warn', {
      usesExpectedIndex,
      planNode: data?.[0]?.Plan?.['Node Type'] ?? null,
    });
  } catch (error) {
    add('migration 104 catalogue query plan', 'warn', {
      error: describeError(error),
      note: 'Supabase may have db_plan_enabled disabled; verify with EXPLAIN in SQL Editor.',
    });
  }
}

await Promise.all([checkCounts(), checkPublicStore(), checkCataloguePlan()]);

const summary = {
  checkedAt: new Date().toISOString(),
  baseUrl,
  result: checks.some((check) => check.status === 'fail') ? 'blocked' : checks.some((check) => check.status === 'warn') ? 'attention' : 'ready',
  checks,
};

console.log(JSON.stringify(summary, null, 2));
process.exitCode = summary.result === 'blocked' ? 1 : 0;
