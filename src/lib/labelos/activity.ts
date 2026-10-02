/**
 * The one writer for `activity_events` (migration 136; 08-search-and-
 * activity.md Part B). Every Label OS mutation records what happened, who
 * did it and which artist / project / song / release it concerns, in the
 * same route as the mutation, after it succeeds. No bus, no queue, no
 * triggers.
 *
 * Two classes of event:
 *  - everyday (song uploaded, stage moved): best effort. A failed write is
 *    logged and returned as `{ ok: false }`, never thrown — the producer's
 *    work already happened and must not be reported as failed.
 *  - audit (06 §6: membership, sharing, restricted downloads, credit and
 *    split decisions, approvals, delivery): NOT best effort. A failed write
 *    throws `AuditEventError`, so a route that forgets to check still fails.
 *    LABEL-19 moves these into one RPC with the mutation, so the two commit
 *    or roll back together; until then the route fails after the mutation.
 *
 * `visibility` defaults to `internal` (business-internal: only members with
 * `business.read.internal` read it under 136's RLS). That is the least
 * visible choice, not the right one for most verbs — pass `'artist'` for
 * events the creative side and the song's artist should see (D5).
 *
 * The verb list is closed: a new kind of event is an edit here, and the
 * activity_events CHECK (`^[a-z_]+\.[a-z_]+$`) is held by a test.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { errorMessage } from '@/lib/errors';
import { createLogger } from '@/lib/log';
import { isUUID } from '@/lib/validate';

const log = createLogger('lib.labelos.activity');

// ── Vocabulary ──────────────────────────────────────────────────────────

export const VERBS = [
  // Organization + membership
  'org.created',
  'org.settings_changed',
  'member.joined',
  'member.removed',
  'member.role_changed',
  'member.scope_changed',
  'member.capabilities_changed',
  'member.artists_changed',
  'invitation.created',
  'invitation.revoked',
  // People directory + roster (LABEL-10; the subject is the contact)
  'contact.created',
  'contact.updated',
  'contact.deleted',
  // Projects + sharing
  'project.created',
  'project.member_added',
  'project.member_removed',
  'share.created',
  'share.revoked',
  // Music
  'song.created',
  'song.stage_changed',
  'song.reviewed',
  'recording.uploaded',
  'recording.downloaded',
  'recording.copied',
  // Files
  'file.uploaded',
  'file.restricted_downloaded',
  // Rights
  'credit.proposed',
  'credit.confirmed',
  'credit.disputed',
  'split_sheet.circulated',
  // Releases
  'approval.requested',
  'approval.decided',
  'release.created',
  'release.delivered',
  // Label ↔ artist connections (LABEL-41)
  'connection.requested',
  'connection.accepted',
  'connection.ended',
] as const;
export type Verb = (typeof VERBS)[number];

/** 06 §6 + 14 (LABEL-13, LABEL-41): kept for the life of the org, never best effort. */
export const AUDIT_VERBS: readonly Verb[] = [
  'member.joined',
  'member.removed',
  'member.role_changed',
  'member.scope_changed',
  'member.capabilities_changed',
  'member.artists_changed',
  'invitation.created',
  'invitation.revoked',
  'project.member_added',
  'project.member_removed',
  'share.created',
  'share.revoked',
  'recording.downloaded',
  'recording.copied',
  'file.restricted_downloaded',
  'credit.confirmed',
  'credit.disputed',
  'split_sheet.circulated',
  'approval.requested',
  'approval.decided',
  'release.delivered',
  'connection.requested',
  'connection.accepted',
  'connection.ended',
];

export function isAuditVerb(verb: string): boolean {
  return (AUDIT_VERBS as readonly string[]).includes(verb);
}

export const SUBJECT_TYPES = [
  'org',
  'member',
  'invitation',
  'contact',
  'project',
  'share',
  'track',
  'asset',
  'comment',
  'credit',
  'split_sheet',
  'approval',
  'release',
  'connection',
] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

/**
 * What the event is about. `id` is the subject row; the four context keys
 * are denormalised so feeds filter by index without joins (08 §B3).
 * `artistId` is the roster artist's CONTACT id (17 R3); the column is still
 * named `artist_id` in migration 136.
 */
export type EventSubject = {
  type: SubjectType;
  id: string | null;
  artistId?: string | null;
  projectId?: string | null;
  songId?: string | null;
  releaseId?: string | null;
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type EventPayload = { [key: string]: Json };

export type EventOptions = {
  /** Force an everyday verb into the audit class. An audit verb cannot be downgraded. */
  audit?: boolean;
  visibility?: 'internal' | 'artist';
};

/** Who is acting in which org. `userId` null = the system (cron). */
export type EventContext = { orgId: string; userId: string | null };

export type RecordEventResult = { ok: true; id: string } | { ok: false; error: string };

export class AuditEventError extends Error {
  constructor(verb: string, cause: string) {
    super(`audit event ${verb} was not recorded: ${cause}`);
    this.name = 'AuditEventError';
  }
}

/** Only `.from(table).insert(row).select().single()` is used. */
export type ActivityAdmin = Pick<SupabaseClient, 'from'>;

// ── Validation ──────────────────────────────────────────────────────────

const PAYLOAD_MAX_BYTES = 16 * 1024;
/** Bearer secrets must never land in a log anyone can read (06 §5). */
const SECRET_KEY = /token|password|secret/i;

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

function invalid(ctx: EventContext, verb: string, subject: EventSubject, payload: unknown): string | null {
  if (!(VERBS as readonly string[]).includes(verb)) return `unknown verb ${verb}`;
  if (!(SUBJECT_TYPES as readonly string[]).includes(subject.type)) return `unknown subject type ${subject.type}`;
  if (!isUUID(ctx.orgId)) return 'orgId is not a uuid';
  if (ctx.userId !== null && !isUUID(ctx.userId)) return 'userId is not a uuid';
  for (const [name, v] of Object.entries({
    id: subject.id,
    artistId: subject.artistId,
    projectId: subject.projectId,
    songId: subject.songId,
    releaseId: subject.releaseId,
  })) {
    if (v != null && !isUUID(v)) return `subject ${name} is not a uuid`;
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'payload must be an object';
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(payload));
  } catch {
    return 'payload is not JSON-serialisable';
  }
  if (size > PAYLOAD_MAX_BYTES) return `payload is ${size} bytes (max ${PAYLOAD_MAX_BYTES})`;
  return null;
}

// ── Writer ──────────────────────────────────────────────────────────────

/**
 * Record one event in the context's org. Call it after the mutation
 * succeeded, with the service-role client the access helper returned.
 * A secret-looking payload key is a programming error and always throws.
 */
export async function recordEvent(
  admin: ActivityAdmin,
  ctx: EventContext,
  verb: Verb,
  subject: EventSubject,
  payload: EventPayload = {},
  opts: EventOptions = {},
): Promise<RecordEventResult> {
  const audit = isAuditVerb(verb) || opts.audit === true;

  const secret = secretKeyIn(payload);
  if (secret) throw new AuditEventError(verb, `payload key "${secret}" looks like a secret`);

  const problem = invalid(ctx, verb, subject, payload);
  if (problem) {
    if (audit) throw new AuditEventError(verb, problem);
    log.error('event refused', { verb, orgId: ctx.orgId, problem });
    return { ok: false, error: problem };
  }

  const row = {
    org_id: ctx.orgId,
    actor_id: ctx.userId,
    verb,
    subject_type: subject.type,
    subject_id: subject.id,
    artist_id: subject.artistId ?? null,
    project_id: subject.projectId ?? null,
    song_id: subject.songId ?? null,
    release_id: subject.releaseId ?? null,
    payload,
    audit,
    visibility: opts.visibility ?? 'internal',
  };

  let error: string | null = null;
  let id: string | null = null;
  try {
    const res = await admin.from('activity_events').insert(row).select('id').single();
    if (res.error) error = res.error.message;
    else id = (res.data as { id?: string } | null)?.id ?? null;
    if (!error && !id) error = 'insert returned no id';
  } catch (err) {
    error = errorMessage(err);
  }

  if (error) {
    if (audit) {
      log.error('audit event write failed', { verb, orgId: ctx.orgId, error });
      throw new AuditEventError(verb, error);
    }
    log.warn('event write failed', { verb, orgId: ctx.orgId, error });
    return { ok: false, error };
  }
  return { ok: true, id: id! };
}
