/**
 * Org invitations (LABEL-08, 04-core-workflows.md W1, 06 §5 "Invitation
 * hardening", risk R-06). Pure rules shared by the routes and the UI:
 *
 *  - the token: 32 random bytes, base64url, handed to the invitee once (in
 *    the email) and stored ONLY as its sha-256 (`org_invitations.token_hash`);
 *  - what an org kind may invite: the roles and functions it offers (06 §2.4b)
 *    minus `owner` — making an owner is the owner-only ownership transfer
 *    (15, LABEL-02 follow-up), not something members.manage can hand out;
 *  - an invitation's state and what the accept function's answer means.
 *
 * Accepting is one SQL function, `labelos_accept_invitation` (migration
 * 138), executable only by service_role. It locks the invitation row, checks
 * email + revoked + used + expiry, writes `org_members` and the
 * `member.joined` audit event in one transaction. Nothing here writes.
 *
 * The token never appears in an application log, an activity payload, an
 * API response or an API query string. It IS the last segment of the join
 * link (`/join/<token>`, like every share link), so it can appear in
 * platform request logs; it is single-use, email-bound and expires in 7 days.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  FUNCTIONS_BY_ORG_KIND,
  ORG_FUNCTIONS,
  ROLES,
  ROLES_BY_ORG_KIND,
  ROLE_USES_FUNCTIONS,
  type OrgFunction,
  type OrgKind,
  type Role,
} from './capabilities';
import { escapeHtml } from '@/lib/email/templates';
import { isUUID } from '@/lib/validate';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const ACCEPT_INVITATION_RPC = 'labelos_accept_invitation';

// ── Tokens ──────────────────────────────────────────────────────────────

/** sha-256, hex: what `org_invitations.token_hash` holds. */
export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function newInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashInvitationToken(token) };
}

/** 32 bytes as unpadded base64url is exactly 43 characters. */
export function isWellFormedInvitationToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

// ── What may be invited ─────────────────────────────────────────────────

export type InvitableRole = Exclude<Role, 'owner'>;

export function invitableRoles(kind: OrgKind): InvitableRole[] {
  return ROLES_BY_ORG_KIND[kind].filter((r): r is InvitableRole => r !== 'owner');
}

export function invitableFunctions(kind: OrgKind): OrgFunction[] {
  return [...FUNCTIONS_BY_ORG_KIND[kind]];
}

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  artist: 'Artist',
};

export const FUNCTION_LABELS: Readonly<Record<OrgFunction, string>> = {
  a_and_r: 'A&R',
  project_manager: 'Project manager',
  marketing: 'Marketing',
  legal: 'Legal',
  finance: 'Finance',
  artist_manager: 'Artist manager',
  producer: 'Producer',
  engineer: 'Engineer',
  operations: 'Operations',
};

export type InvitationGrantInput = { role: string; functions: readonly string[]; contactIds: readonly string[] };

export type InvitationGrant =
  | {
      ok: true;
      role: InvitableRole;
      functions: OrgFunction[];
      /** The roster artists (contacts, 17 R3) the member is limited to. The route checks they are contacts of the org. */
      contactIds: string[];
      /** What the accepted membership's `org_members.scope` will be. */
      scope: 'org' | 'artists';
    }
  | { ok: false; error: string };

/**
 * Is this role + functions + artist list something an org of this kind may
 * invite? Anything the kind does not offer is refused (400), never dropped.
 */
export function validateInvitationGrant(kind: OrgKind, input: InvitationGrantInput): InvitationGrant {
  const role = ROLES.find((r) => r === input.role);
  if (!role) return { ok: false, error: `Unknown role "${input.role}"` };
  if (role === 'owner') return { ok: false, error: 'Owners cannot be invited; ownership is transferred' };
  if (!ROLES_BY_ORG_KIND[kind].includes(role)) {
    return { ok: false, error: `A ${kind} organization cannot invite the role "${role}"` };
  }

  const functions: OrgFunction[] = [];
  for (const raw of input.functions) {
    const fn = ORG_FUNCTIONS.find((f) => f === raw);
    if (!fn) return { ok: false, error: `Unknown function "${raw}"` };
    if (!FUNCTIONS_BY_ORG_KIND[kind].includes(fn)) {
      return { ok: false, error: `A ${kind} organization does not offer the function "${fn}"` };
    }
    if (!functions.includes(fn)) functions.push(fn);
  }
  if (functions.length > 0 && !ROLE_USES_FUNCTIONS[role]) {
    return { ok: false, error: `The ${role} role does not take functions` };
  }

  const contactIds: string[] = [];
  for (const id of input.contactIds) {
    if (!isUUID(id)) return { ok: false, error: 'contact_ids must be uuids' };
    const lower = id.toLowerCase();
    if (!contactIds.includes(lower)) contactIds.push(lower);
  }
  if (role === 'admin' && contactIds.length > 0) {
    return { ok: false, error: 'An admin cannot be limited to some artists' };
  }

  // 06 §2.5: an artist is always artist-scoped; anyone limited to named
  // artists is too. The same rule is in labelos_accept_invitation.
  const scope = role === 'artist' || contactIds.length > 0 ? 'artists' : 'org';
  return { ok: true, role, functions, contactIds, scope };
}

// ── State ───────────────────────────────────────────────────────────────

export type InvitationState = 'pending' | 'accepted' | 'revoked' | 'expired';

export type InvitationTimes = {
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

/** Revoked wins, then accepted (a used link stays "used" after its expiry), then expiry. */
export function invitationState(row: InvitationTimes, now: Date = new Date()): InvitationState {
  if (row.revoked_at) return 'revoked';
  if (row.accepted_at) return 'accepted';
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires) || expires <= now.getTime()) return 'expired';
  return 'pending';
}

// ── Accepting ───────────────────────────────────────────────────────────

export type AcceptErrorCode =
  | 'not_found'
  | 'email_mismatch'
  | 'email_unverified'
  | 'revoked'
  | 'expired'
  | 'used'
  | 'unsupported'
  | 'schema_missing'
  | 'failed';

export type AcceptOutcome =
  | { ok: true; orgId: string; alreadyMember: boolean }
  | { ok: false; status: 403 | 404 | 409 | 410 | 500 | 503; code: AcceptErrorCode; message: string };

/**
 * The client-facing answers. The mismatch message deliberately does not
 * name (or hint at) the invited address (R-06).
 */
const ACCEPT_ERRORS: Readonly<Record<Exclude<AcceptErrorCode, 'schema_missing' | 'failed'>, { status: 403 | 404 | 409 | 410; message: string }>> = {
  not_found: { status: 404, message: 'This invitation does not exist' },
  unsupported: { status: 404, message: 'This invitation does not exist' },
  email_mismatch: {
    status: 403,
    message: 'This invitation was sent to a different email address. Sign in with the address it was sent to.',
  },
  email_unverified: {
    status: 403,
    message: 'Confirm your email address first: open the confirmation email, then accept again.',
  },
  // Also: the inviter no longer holds members.manage in the org (migration 138).
  revoked: { status: 410, message: 'This invitation was withdrawn' },
  expired: { status: 410, message: 'This invitation has expired. Ask for a new one.' },
  used: { status: 409, message: 'This invitation has already been used' },
};

type RpcError = { code?: string; message?: string } | null;

const MISSING_SCHEMA_CODES = new Set(['PGRST202', '42883', '42P01', '42703', 'PGRST205']);

export function interpretAcceptResult(data: unknown, error: RpcError): AcceptOutcome {
  if (error) {
    const missing =
      (error.code && MISSING_SCHEMA_CODES.has(error.code)) ||
      (typeof error.message === 'string' && /does not exist|schema cache/i.test(error.message));
    return missing
      ? { ok: false, status: 503, code: 'schema_missing', message: 'Invitations are not available yet (migration 138)' }
      : { ok: false, status: 500, code: 'failed', message: 'Could not accept the invitation' };
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (typeof d.error === 'string' && d.error in ACCEPT_ERRORS) {
      const code = d.error as keyof typeof ACCEPT_ERRORS;
      return { ok: false, code, ...ACCEPT_ERRORS[code] };
    }
    if ((d.status === 'joined' || d.status === 'already_member') && typeof d.org_id === 'string' && isUUID(d.org_id)) {
      return { ok: true, orgId: d.org_id, alreadyMember: d.status === 'already_member' };
    }
  }
  return { ok: false, status: 500, code: 'failed', message: 'Could not accept the invitation' };
}

// ── Email ───────────────────────────────────────────────────────────────

export function describeGrant(role: Role, functions: readonly OrgFunction[]): string {
  const label = ROLE_LABELS[role];
  if (functions.length === 0) return label;
  return `${label} · ${functions.map((f) => FUNCTION_LABELS[f]).join(', ')}`;
}

/**
 * The invitation email. Dark text on the white button: the dormant
 * `/api/invite` email put white on white (R-22), which this replaces.
 */
export function buildInvitationEmail(opts: {
  orgName: string;
  /** Null: the email names the org only. */
  inviterName: string | null;
  role: Role;
  functions: readonly OrgFunction[];
  url: string;
}): { subject: string; html: string; text: string } {
  const grant = describeGrant(opts.role, opts.functions);
  const subject = opts.inviterName
    ? `${opts.inviterName} invited you to ${opts.orgName}`
    : `You're invited to ${opts.orgName}`;
  const org = escapeHtml(opts.orgName);
  const lead = opts.inviterName ? `${escapeHtml(opts.inviterName)} invited you` : 'You have been invited';
  const url = escapeHtml(opts.url);
  const html = `<div style="background-color:#090907;color:#EEE8DD;padding:40px;font-family:Helvetica,Arial,sans-serif;">
  <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#AAA294;">Invitation</p>
  <h1 style="margin:0 0 16px;font-size:22px;color:#FFFFFF;">${org}</h1>
  <p style="margin:0 0 8px;font-size:14px;line-height:1.6;color:#EEE8DD;">${lead} to join ${org} as <strong style="color:#FFFFFF;">${escapeHtml(grant)}</strong>.</p>
  <p style="margin:0 0 24px;font-size:13px;line-height:1.6;color:#AAA294;">Sign in with this email address to accept. The link works once and expires in 7 days.</p>
  <a href="${url}" style="background-color:#FFFFFF;color:#090907;padding:12px 24px;text-decoration:none;border-radius:8px;display:inline-block;font-size:13px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;">Accept invitation</a>
  <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#AAA294;">If you were not expecting this, ignore it. Nothing happens unless you accept.</p>
</div>`;
  const text = [
    `${opts.inviterName ? `${opts.inviterName} invited you` : 'You have been invited'} to join ${opts.orgName} as ${grant}.`,
    '',
    `Accept: ${opts.url}`,
    '',
    'Sign in with this email address to accept. The link works once and expires in 7 days.',
  ].join('\n');
  return { subject, html, text };
}

// ── The join page ───────────────────────────────────────────────────────

/** What `POST /api/org/join { action: 'preview' }` answers. */
export type InvitationPreview = {
  org: { name: string; kind: string; slug?: string };
  role: string;
  functions: string[];
  state: InvitationState;
  signedIn: boolean;
  emailMatches: boolean | null;
  member: boolean;
};

export type JoinStep = 'member' | 'revoked' | 'expired' | 'used' | 'sign_in' | 'wrong_account' | 'ready';

/**
 * Which screen `/join/<token>` shows. A member always gets "open the org"
 * (that is the idempotent second visit, whatever the link's state); a dead
 * link says why before asking anyone to sign in; then sign in, then the
 * account must be the invited one, then Accept.
 */
export function joinStep(p: InvitationPreview): JoinStep {
  if (p.member) return 'member';
  if (p.state === 'revoked') return 'revoked';
  if (p.state === 'expired') return 'expired';
  if (p.state === 'accepted') return 'used';
  if (!p.signedIn) return 'sign_in';
  if (p.emailMatches === false) return 'wrong_account';
  return 'ready';
}
