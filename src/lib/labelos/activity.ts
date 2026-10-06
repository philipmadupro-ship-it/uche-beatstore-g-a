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
 *    LABEL-19 puts the audit verbs that have a mutating route behind one
 *    Postgres function each (lib/labelos/audit-rpc.ts, migration 146), so the
 *    mutation and its event commit or roll back together. recordEvent stays
 *    the writer for everything else, and for audit verbs whose mutation does
 *    not exist yet (downloads of restricted files, which only read).
 *
 * `visibility` defaults per verb (`defaultVisibility`, LABEL-19): `internal`
 * rows are read only by members with `business.read.internal` under 136's
 * RLS, `artist` rows by everyone who can read the catalogue (and then only
 * inside their artist scope). A route passes `visibility` only when the
 * verb's default is wrong for THIS event (a restricted file's upload).
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
  'project.member_changed',
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
  // Comments (LABEL-22; the subject is the comment, never its words)
  'comment.created',
  'comment.updated',
  'comment.resolved',
  'comment.deleted',
  // Tasks (LABEL-23)
  'task.created',
  'task.updated',
  'task.completed',
  'task.deleted',
  // Files
  'file.uploaded',
  'file.updated',
  'file.deleted',
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
  'release.updated',
  'release.deleted',
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
  'project.member_changed',
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

export type EventVisibility = 'internal' | 'artist';

/**
 * Who reads an event when the route does not say (LABEL-19, D4 + D5 + 08 §B4).
 *
 *  - `artist`: the creative record of a song, a project or a release — what
 *    was made, moved on, reviewed, credited. Visible to every member who can
 *    read the catalogue, inside their artist scope, and to the song's artist
 *    (D5: an artist sees everything about their own songs except business-
 *    internal notes). A&R, producers and engineers hold `catalog.read` but
 *    not `business.read.internal`, so they see only these.
 *  - `internal`: the business side — who the members are and what they may
 *    do, invitations, the contact directory, sharing, who downloaded what,
 *    split sheets and approvals (contracts and release gates), the org's own
 *    settings, label ↔ artist connections. Also files: a file's sensitivity
 *    decides, and the file routes override to `artist` for anything that is
 *    not restricted (D4: contracts never reach the creative side).
 *
 * Total over `Verb` (a test holds it), so a new verb forces a decision.
 */
export const DEFAULT_VISIBILITY: Readonly<Record<Verb, EventVisibility>> = {
  'org.created': 'internal',
  'org.settings_changed': 'internal',
  'member.joined': 'internal',
  'member.removed': 'internal',
  'member.role_changed': 'internal',
  'member.scope_changed': 'internal',
  'member.capabilities_changed': 'internal',
  'member.artists_changed': 'internal',
  'invitation.created': 'internal',
  'invitation.revoked': 'internal',
  'contact.created': 'internal',
  'contact.updated': 'internal',
  'contact.deleted': 'internal',
  'project.created': 'artist',
  'project.member_added': 'internal',
  'project.member_changed': 'internal',
  'project.member_removed': 'internal',
  'share.created': 'internal',
  'share.revoked': 'internal',
  'song.created': 'artist',
  'song.stage_changed': 'artist',
  'song.reviewed': 'artist',
  'recording.uploaded': 'artist',
  'recording.downloaded': 'internal',
  'recording.copied': 'internal',
  // The creative record (a note on a mix). A route overrides to `internal` for
  // an internal comment — the event of a team-only note is team-only too.
  'comment.created': 'artist',
  'comment.updated': 'artist',
  'comment.resolved': 'artist',
  'comment.deleted': 'artist',
  // Tasks are the business side: each function keeps its own (D1), so A&R / producers / engineers
  // (catalog.read, no business.read.internal) do not read another side's task history.
  'task.created': 'internal',
  'task.updated': 'internal',
  'task.completed': 'internal',
  'task.deleted': 'internal',
  'file.uploaded': 'internal',
  'file.updated': 'internal',
  'file.deleted': 'internal',
  'file.restricted_downloaded': 'internal',
  'credit.proposed': 'artist',
  'credit.confirmed': 'artist',
  'credit.disputed': 'artist',
  'split_sheet.circulated': 'internal',
  'approval.requested': 'internal',
  'approval.decided': 'internal',
  'release.created': 'artist',
  'release.updated': 'artist',
  'release.deleted': 'artist',
  'release.delivered': 'artist',
  'connection.requested': 'internal',
  'connection.accepted': 'internal',
  'connection.ended': 'internal',
};

export function defaultVisibility(verb: Verb): EventVisibility {
  return DEFAULT_VISIBILITY[verb];
}

/**
 * A file event's visibility, from the sensitivity of the file before and
 * after the change (pass each one that applies). A restricted file — a
 * contract, 06 §2.4 — keeps its history business-internal, and so does one
 * that WAS restricted when it changed: the one rule behind file.uploaded,
 * file.updated and file.deleted. Everything else is creative-side work the
 * project's artist may see (D5). Unknown sensitivity reads as restricted:
 * fail closed.
 */
export function fileEventVisibility(...sensitivities: (string | null | undefined)[]): EventVisibility {
  return sensitivities.every((s) => s === 'normal') ? 'artist' : 'internal';
}

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
  'task',
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
  /** Overrides `defaultVisibility(verb)`; only for an event the default misjudges. */
  visibility?: EventVisibility;
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
    visibility: opts.visibility ?? defaultVisibility(verb),
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
