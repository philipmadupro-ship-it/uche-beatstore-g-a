import { hashClientIp } from '@/lib/security/ip-hash';
import { createLogger } from '@/lib/log';
import { errorMessage } from '@/lib/errors';

const log = createLogger('store.download-audit');

/**
 * The download audit log: one `store_events` row per file a buyer was granted
 * or refused, so the producer can answer "did they get it, when, and what was
 * refused". No table of its own: `store_events` is the open event log (mig 097,
 * `event_type` is free text on the table) with producer-only read RLS and a
 * salted IP hash. Only the SERVER writes this type — the public
 * /api/store/event endpoint validates against a closed enum that excludes it,
 * so it cannot be forged from a browser.
 *
 * What a row carries: seller, track, and metadata { purchase_kind,
 * purchase_id, format, outcome, reason? }. It does NOT carry the Stripe
 * session id or a bundle token: those are bearer credentials for the files.
 * `purchase_id` is the row id, which is not.
 */
export const DOWNLOAD_EVENT_TYPE = 'download';

export type DownloadOutcome = 'granted' | 'denied';

export type DownloadDenial =
  | 'revoked'
  | 'under-review'
  | 'expired'
  | 'track-not-in-purchase'
  | 'format-not-permitted'
  | 'file-missing';

export type DownloadAuditEntry = {
  sellerUserId: string | null;
  trackId: string;
  purchaseKind: 'track_license' | 'project';
  purchaseId: string | null;
  format: string;
  outcome: DownloadOutcome;
  reason?: DownloadDenial;
  ip: string;
};

/** Minimal slice of the service client this needs (keeps the helper testable). */
type AuditClient = {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Should a request that was GRANTED be written down?
 *
 * One save is several requests: the page's pre-check asks for a single byte
 * (`X-Download-Probe`), and a browser resuming a download asks for the middle
 * of the file. Neither is a new download, so only a request for the start of
 * the file (no Range, or a Range from byte 0) counts.
 */
export function shouldLogGrant(rangeHeader: string | null, isProbe: boolean): boolean {
  if (isProbe) return false;
  if (!rangeHeader) return true;
  return /^bytes=0-/.test(rangeHeader.trim());
}

/**
 * Best-effort: a failed audit write must never block or fail a download the
 * buyer paid for, so errors are logged and swallowed.
 */
export async function recordDownload(admin: AuditClient, entry: DownloadAuditEntry): Promise<void> {
  try {
    const { error } = await admin.from('store_events').insert({
      event_type: DOWNLOAD_EVENT_TYPE,
      seller_user_id: entry.sellerUserId,
      track_id: UUID_RE.test(entry.trackId) ? entry.trackId : null,
      ip_hash: hashClientIp(entry.ip),
      metadata: {
        purchase_kind: entry.purchaseKind,
        purchase_id: entry.purchaseId,
        format: entry.format,
        outcome: entry.outcome,
        ...(entry.reason ? { reason: entry.reason } : {}),
      },
    });
    if (error) log.warn('download audit write failed', { error: error.message });
  } catch (err) {
    log.warn('download audit write threw', { error: errorMessage(err) });
  }
}
