/**
 * Direct-ask notifications for Label OS (LABEL-23, 08 §B6, 13 R-19).
 *
 * A notification interrupts ONE person because THEY must act: a task handed
 * to them, an approval asked of them, an @mention of them, a credit that
 * names them, an invitation to them. Everything else — an upload, a stage
 * move, a review, a new member — is in the activity digest, never the bell.
 * The producer's old bell filled with noise one "just one more kind" at a
 * time; this module is where that is stopped:
 *
 *  - the kinds are a CLOSED union (`DIRECT_ASK_KINDS`), and a test fails any
 *    kind that reads as a broadcast ("everyone", "upload", "created", …);
 *  - the API takes ONE recipient (`recipientId: string`, never a list and
 *    never "the org" or "the owner"), so a fan-out is a loop somebody has to
 *    write on purpose — and a source-scan test fails any write to the
 *    `notifications` table under `src/app/api/org` or `src/lib/labelos`
 *    that does not go through here;
 *  - asking yourself for something notifies nobody.
 *
 * Rows land in the existing `notifications` table (064) with `org_id` set
 * (migration 151); producer notifications keep `org_id` NULL and are not
 * written here. Best effort, like an activity event: the work already
 * happened, and a failed notification must not report it as failed.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

const log = createLogger('lib.labelos.notify');

import { DIRECT_ASK_KINDS, isDirectAskKind, type DirectAskKind } from './notify-kinds';

export { DIRECT_ASK_KINDS, isDirectAskKind, type DirectAskKind };

/** One line a person reads in the bell, per kind. The title never carries the asker's email. */
const TITLE: Record<DirectAskKind, string> = {
  task_assigned: 'assigned you a task',
  approval_requested: 'asked for your approval',
  mention: 'mentioned you',
  credit_named_you: 'named you in a credit',
  invitation: 'invited you',
};

export const NOTIFICATION_TITLE_MAX = 160;
export const NOTIFICATION_BODY_MAX = 300;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export type DirectAsk = {
  kind: DirectAskKind;
  orgId: string;
  /** The ONE person being asked. */
  recipientId: string;
  /** Who asked; null = the system. Never notified of their own ask. */
  actorId: string | null;
  /** The asker's display name, for the title ("Sam assigned you a task"). */
  actorName?: string | null;
  /** What it is about: a task's title, a song's title. Shown as the body. */
  subject?: string | null;
  /** Ids the bell links with (never the asker's email, a token or a secret). */
  data?: { [key: string]: Json };
};

export type NotificationRow = {
  user_id: string;
  org_id: string;
  kind: DirectAskKind;
  title: string;
  body: string | null;
  data: { [key: string]: Json };
  read: false;
};

const SECRET_KEY = /token|password|secret|email/i;

function secretKeyIn(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = secretKeyIn(v);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) return k;
      const hit = secretKeyIn(v);
      if (hit) return hit;
    }
  }
  return null;
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);

/**
 * The row for a direct ask, or the reason there is none. `self` is not an
 * error: a person who assigns themself a task is simply not asked.
 */
export function buildDirectAsk(ask: DirectAsk): { ok: true; row: NotificationRow } | { ok: false; reason: 'self' | 'invalid'; detail?: string } {
  if (!isDirectAskKind(ask.kind)) return { ok: false, reason: 'invalid', detail: `not a direct-ask kind: ${String(ask.kind)}` };
  if (!isUUID(ask.orgId) || !isUUID(ask.recipientId)) return { ok: false, reason: 'invalid', detail: 'orgId and recipientId must be uuids' };
  if (ask.actorId !== null && !isUUID(ask.actorId)) return { ok: false, reason: 'invalid', detail: 'actorId must be a uuid or null' };
  if (ask.actorId !== null && ask.actorId.toLowerCase() === ask.recipientId.toLowerCase()) return { ok: false, reason: 'self' };
  const data = ask.data ?? {};
  const secret = secretKeyIn(data);
  if (secret) return { ok: false, reason: 'invalid', detail: `data carries a secret-looking key: ${secret}` };

  const who = squash(ask.actorName ?? '') || 'Someone';
  const subject = squash(ask.subject ?? '');
  return {
    ok: true,
    row: {
      user_id: ask.recipientId.toLowerCase(),
      org_id: ask.orgId.toLowerCase(),
      kind: ask.kind,
      title: clip(`${who} ${TITLE[ask.kind]}`, NOTIFICATION_TITLE_MAX),
      body: subject ? clip(subject, NOTIFICATION_BODY_MAX) : null,
      data,
      read: false,
    },
  };
}

/** Only `.from(table).insert(row)` is used. */
export type NotifyAdmin = Pick<SupabaseClient, 'from'>;

export type NotifyResult = { ok: true } | { ok: false; skipped: 'self' | 'invalid' | 'failed' };

/**
 * Write one direct-ask notification, best effort. Call it after the change
 * that made the ask succeeded, with the service-role client the access helper
 * returned. It never throws.
 */
export async function notifyDirectAsk(admin: NotifyAdmin, ask: DirectAsk): Promise<NotifyResult> {
  const built = buildDirectAsk(ask);
  if (!built.ok) {
    if (built.reason === 'invalid') log.warn('direct ask refused', { kind: ask.kind, orgId: ask.orgId, detail: built.detail });
    return { ok: false, skipped: built.reason };
  }
  try {
    const { error } = await admin.from('notifications').insert(built.row);
    if (error) {
      log.error('notification write failed', { kind: ask.kind, orgId: ask.orgId, error: error.message });
      return { ok: false, skipped: 'failed' };
    }
    return { ok: true };
  } catch (err) {
    log.error('notification write threw', { kind: ask.kind, orgId: ask.orgId, error: errorMessage(err) });
    return { ok: false, skipped: 'failed' };
  }
}
