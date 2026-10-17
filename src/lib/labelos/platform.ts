/**
 * The platform console (LABEL-47): what the operator sees of each licensee
 * and how a console request becomes a licence. Pure; the routes under
 * /api/platform do the reads and writes (lib/auth/platform-access gates them).
 *
 * The console never sees inside a licensee: names, kind, the licence itself,
 * and counts of seats and artists — the numbers the caps are about. No member
 * names or emails, no catalogue. The one email shown is a pending OWNER
 * invitation's, which the operator typed themself.
 */
import { groupOfCategory } from '@/lib/contacts/roles';
import { ACCOUNT_FACES, FACE_KIND, accountFace, type AccountFace } from './account';
import { MODULES, normalizeModules, orgEntitlements, takesSeat, type EntitlementRow, type Module } from './entitlements';

export const LICENSEE_KINDS = ['artist', 'label'] as const;

/** Modules a new licence starts with when the operator does not say: everything the face allows. */
export function defaultModulesFor(face: AccountFace): Module[] {
  return normalizeModules(FACE_KIND[face], MODULES);
}

export type LicensePlanInput = {
  face: AccountFace;
  modules?: readonly string[] | null;
  max_seats?: number | null;
  max_artists?: number | null;
};

export type LicensePlan = {
  kind: 'artist' | 'label';
  modules: Module[];
  maxSeats: number | null;
  maxArtists: number | null;
};

/**
 * The licence a request asks for. Modules are normalised to the face's
 * ceiling (unknown names dropped); omitted = the face's default. An
 * independent account is one artist by definition (D1), so an artist cap is
 * meaningless there and is not stored.
 */
export function planLicense(input: LicensePlanInput): LicensePlan {
  const kind = FACE_KIND[input.face];
  const modules = input.modules == null ? defaultModulesFor(input.face) : normalizeModules(kind, input.modules);
  return {
    kind,
    modules,
    maxSeats: input.max_seats ?? null,
    maxArtists: input.face === 'independent' ? null : input.max_artists ?? null,
  };
}

/** The audit payload of a licence change: what was set, and what it replaced (null = the default). Never an email. */
export function licensePayload(plan: LicensePlan, previous: EntitlementRow | null, extra: Record<string, string | boolean> = {}) {
  return {
    source: 'platform',
    modules: plan.modules,
    max_seats: plan.maxSeats,
    max_artists: plan.maxArtists,
    previous: previous
      ? { modules: previous.modules ?? [], max_seats: previous.max_seats, max_artists: previous.max_artists }
      : null,
    ...extra,
  };
}

// ── The listing ─────────────────────────────────────────────────────────

export type LicenseeOrgRow = { id: string; name: string; slug: string; kind: string; created_at: string };
export type LicenseeMemberRow = { org_id: string; role: string };
export type LicenseeContactRow = { org_id: string; category: string | null; secondary_category: string | null };
export type LicenseeInviteRow = { org_id: string; email: string; expires_at: string };

export type LicenseeView = {
  id: string;
  name: string;
  slug: string;
  face: AccountFace;
  createdAt: string;
  /** False = no row yet: the default licence (everything the face allows). */
  licensed: boolean;
  modules: Module[];
  maxSeats: number | null;
  maxArtists: number | null;
  setupDone: boolean;
  seatsUsed: number;
  artists: number;
  owners: number;
  pendingOwnerInvites: { email: string; expiresAt: string }[];
};

function isRosterArtist(c: LicenseeContactRow): boolean {
  return groupOfCategory(c.category) === 'artist' || groupOfCategory(c.secondary_category) === 'artist';
}

/** One row per licensee, newest first. Orgs without a face (the producer's own) are left out. */
export function licenseeViews(input: {
  orgs: readonly LicenseeOrgRow[];
  entitlements: readonly (EntitlementRow & { org_id: string })[];
  members: readonly LicenseeMemberRow[];
  contacts: readonly LicenseeContactRow[];
  ownerInvites: readonly LicenseeInviteRow[];
}): LicenseeView[] {
  const ent = new Map(input.entitlements.map((e) => [e.org_id, e]));
  const out: LicenseeView[] = [];
  for (const org of input.orgs) {
    const face = accountFace(org);
    if (!face) continue;
    const e = orgEntitlements(org, ent.get(org.id) ?? null);
    const members = input.members.filter((m) => m.org_id === org.id);
    out.push({
      id: org.id,
      name: org.name,
      slug: org.slug,
      face,
      createdAt: org.created_at,
      licensed: e.licensed,
      modules: MODULES.filter((m) => e.modules.has(m)),
      maxSeats: e.maxSeats,
      maxArtists: e.maxArtists,
      setupDone: e.setupDone,
      seatsUsed: members.filter((m) => takesSeat(m.role)).length,
      artists: input.contacts.filter((c) => c.org_id === org.id && isRosterArtist(c)).length,
      owners: members.filter((m) => m.role === 'owner').length,
      pendingOwnerInvites: input.ownerInvites
        .filter((i) => i.org_id === org.id)
        .map((i) => ({ email: i.email, expiresAt: i.expires_at }))
        .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)),
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.slug.localeCompare(b.slug));
}

export { ACCOUNT_FACES };

// ── Console form helpers ────────────────────────────────────────────────

/**
 * A cap field as typed: blank = unlimited (null), a whole number ≥ `min`
 * otherwise. Anything else is an error the form shows; "0 seats" is not
 * unlimited (an org needs its owner's seat), so seats use `min` 1.
 */
export function parseCapInput(text: string, min: number): { ok: true; value: number | null } | { ok: false; error: string } {
  const t = text.trim();
  if (t === '') return { ok: true, value: null };
  if (!/^\d{1,6}$/.test(t)) return { ok: false, error: 'A whole number, or blank for unlimited' };
  const n = Number(t);
  if (n < min) return { ok: false, error: `At least ${min}, or blank for unlimited` };
  return { ok: true, value: n };
}

/** "3 of 5" / "3 · unlimited". */
export function usageLabel(used: number, cap: number | null): string {
  return cap === null ? `${used} · no limit` : `${used} of ${cap}`;
}
