/**
 * Team accounts an organization creates for its people
 * (docs/bstudio-label-os/25-team-accounts.md, phase 1; migration 190).
 *
 * An owner or admin creates a login directly — email, name, a password they
 * choose, and the role / functions / artist list an invitation would carry —
 * instead of sending an invitation the person must accept. The person signs
 * in with it, is asked to set their own password, and from then on the org
 * can reset it or switch the account off, but never read it: passwords live
 * only as Supabase's hash.
 *
 * Pure: no I/O. Routes `/api/org/[orgId]/team-accounts{,/[userId]}` and
 * `/api/org/account/password`; the SQL rules are 190's functions.
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

/** Null when acceptable; otherwise what to tell the person typing it. */
export function passwordProblem(password: unknown, email?: string | null): string | null {
  if (typeof password !== 'string') return 'Enter a password.';
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (password.trim() !== password) return 'A password cannot start or end with a space.';
  if (/[\u0000-\u001f\u007f]/.test(password)) return 'A password cannot contain control characters.';
  if (new Set(password).size < 4) return 'Use a less repetitive password.';
  const local = (email ?? '').split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) return 'A password cannot contain the email address.';
  return null;
}

/**
 * A readable, strong password for the creator to hand over: 4 groups of 4
 * from an alphabet without look-alikes (no 0/O, 1/l/I). `random` is
 * injectable so tests are deterministic; the page passes crypto.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generatePassword(random: (n: number) => Uint32Array): string {
  const values = random(16);
  const chars = Array.from(values, (v) => ALPHABET[v % ALPHABET.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-');
}

// ── What the database answered ─────────────────────────────────────────

export type CreateOutcome =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: string; code: string };

/** `labelos_audit_team_account_create`'s answer. Anything unexpected is a thrown 500 in the route. */
export function interpretCreate(data: unknown): CreateOutcome | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d.ok === true) return { ok: true };
  switch (d.error) {
    case 'seat_limit':
      return { ok: false, status: 409, code: 'seat_limit', error: 'Every seat of your licence is taken. Remove someone or ask for more seats.' };
    case 'already_member':
      return { ok: false, status: 409, code: 'already_member', error: 'This person is already a member.' };
    case 'bad_role':
      return { ok: false, status: 400, code: 'bad_role', error: 'That role cannot be given to a new account.' };
    default:
      return null;
  }
}

export type TargetReason = 'self' | 'not_managed' | 'not_member' | 'owner_only' | 'shared';

/**
 * Why an account cannot be reset or switched off by this org (190's
 * `labelos_team_account_target`). An account the org did not create answers
 * like one that does not exist: 404, no hint that it is a real person.
 */
export function targetRefusal(reason: unknown): { status: 403 | 404 | 409; error: string; code: TargetReason } | null {
  switch (reason) {
    case 'self':
      return { status: 409, code: 'self', error: 'Change your own password from your account, not here.' };
    case 'not_managed':
    case 'not_member':
      return { status: 404, code: reason, error: 'This organization did not create that account.' };
    case 'owner_only':
      return { status: 403, code: 'owner_only', error: 'Only an owner can do this to an owner.' };
    case 'shared':
      return {
        status: 409,
        code: 'shared',
        error: 'This account is also used elsewhere, so only its owner can change it. Remove them from the team instead.',
      };
    default:
      return null;
  }
}

/** Supabase admin API: the address already has an account. Never touched; invite them instead. */
export function isEmailTaken(error: { message?: string; code?: string; status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_exists' || error.code === 'user_already_exists') return true;
  return /already (been )?registered|already exists/i.test(error.message ?? '');
}

export const EMAIL_TAKEN =
  'This email already has an account. Invite them instead: they will join with the account they already have.';

/** Long enough that a banned account cannot sign in for the life of the product (~100 years). */
export const BAN_FOREVER = '876000h';

export const TEAM_ACCOUNTS_NOT_READY = 'Team accounts are not set up yet (migration 190 has not been applied).';

/** 190 not applied: the functions or the table are missing. */
export function isMissingTeamAccounts(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (!/team_account|org_managed_accounts/.test(error.message ?? '')) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === 'PGRST205' ||
    error.code === '42883' ||
    error.code === '42P01' ||
    /could not find the (function|table)|does not exist/i.test(error.message ?? '')
  );
}

// ── The members list ───────────────────────────────────────────────────

export type ManagedRow = {
  user_id: string;
  must_change_password: boolean;
  disabled_at: string | null;
  created_at: string;
};

/** What a manager sees on a member row the org created. Never a password. */
export type ManagedView = { pending_password_change: boolean; disabled: boolean; created_at: string };

export function toManagedView(row: ManagedRow): ManagedView {
  return { pending_password_change: row.must_change_password, disabled: row.disabled_at !== null, created_at: row.created_at };
}
