/**
 * Self-service account setup (LABEL-48, first slice): a new account says
 * what it is and gets its own organization, instead of landing on the buyer
 * account page with no way in.
 *
 * Two faces (owner decision, doc 23 §"Owner decisions" 1):
 *  - `independent` — one person who is artist and producer at once. Org kind
 *    `artist`, created with the person as its one roster artist (D1, roster.ts).
 *  - `label` — an organisation with artists, producers and staff. Org kind
 *    `label`, empty roster.
 * The `producer` kind stays the studio's personal org (migration 137) and is
 * never self-served.
 *
 * The org, its owner membership and (independent) the artist contact — made
 * by migration 139's org trigger — are written in ONE transaction by
 * `labelos_setup_org` (migration 189), so a
 * setup that fails midway leaves nothing half-made. One self-served org per
 * account: asking again answers the existing one (idempotent).
 *
 * Pure: no I/O here. Route `src/app/api/org/setup/route.ts`, page
 * `src/app/(label)/setup`.
 */
import { isUUID } from '@/lib/uuid';
import type { OrgKind } from './capabilities';

export const SETUP_FACES = ['independent', 'label'] as const;
export type SetupFace = (typeof SETUP_FACES)[number];

export const SETUP_ORG_RPC = 'labelos_setup_org';

/** The page that asks. */
export const SETUP_PATH = '/setup';

export const SETUP_NAME_MAX = 80;

export const FACE_COPY: Readonly<Record<SetupFace, { title: string; blurb: string; nameLabel: string; namePlaceholder: string }>> = {
  independent: {
    title: 'Independent artist / producer',
    blurb: 'Just you. Your songs, beats, collaborators and releases in one place.',
    nameLabel: 'Artist name',
    namePlaceholder: 'e.g. Nova',
  },
  label: {
    title: 'Label',
    blurb: 'A team with a roster: artists, producers, rappers, collaborators and staff.',
    nameLabel: 'Label name',
    namePlaceholder: 'e.g. Northside Records',
  },
};

export function isSetupFace(value: unknown): value is SetupFace {
  return typeof value === 'string' && (SETUP_FACES as readonly string[]).includes(value);
}

export function kindForFace(face: SetupFace): Extract<OrgKind, 'artist' | 'label'> {
  return face === 'label' ? 'label' : 'artist';
}

/** Collapse whitespace; null when nothing usable is left or it is too long. */
export function cleanOrgName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name || name.length > SETUP_NAME_MAX) return null;
  if (/[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}

/**
 * The face a new sign-up picked, carried in Supabase `user_metadata`
 * (email sign-up) so the choice survives the confirmation email. Null when
 * the account never picked one (a buyer, or someone who signed in with
 * Google, whose choice travels in `?type=` instead).
 */
export function faceFromMetadata(metadata: unknown): SetupFace | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const v = (metadata as Record<string, unknown>).account_type;
  return isSetupFace(v) ? v : null;
}

/** `/setup`, with the face when one was picked. */
export function setupHref(face: SetupFace | null): string {
  return face ? `${SETUP_PATH}?type=${face}` : SETUP_PATH;
}

/**
 * Where src/proxy.ts sends a signed-in user who is neither the producer nor
 * a member of anything, when they open `/login` or a dashboard page.
 *
 * Before this, every such account went to the buyer page — so an artist or a
 * label who had just signed up (or who signed in again before finishing
 * setup) had no way to an organization at all. Now, with Label OS on, they
 * go to /setup (with the face they picked at sign-up, when there is one);
 * the page itself offers "only here to buy beats" for a buyer who followed a
 * dashboard link. Buyers signing in through /store/account never pass here.
 * Label OS off: the buyer page, exactly as before.
 */
export function nonMemberLanding(input: { labelOsEnabled: boolean; metadata: unknown }): string {
  if (!input.labelOsEnabled) return BUYER_HOME;
  return setupHref(faceFromMetadata(input.metadata));
}

export const BUYER_HOME = '/store/account/me';

export type SetupOrgResult =
  | { status: 'created' | 'exists'; orgId: string; slug: string; kind: 'artist' | 'label' }
  | { status: 'schema_missing' }
  | { status: 'failed'; error: string };

type RpcError = { code?: string; message?: string } | null;

const MISSING_SCHEMA_CODES = new Set(['PGRST202', '42883', '42P01', '42703', 'PGRST205']);

/** Pure: what `labelos_setup_org`'s answer means. */
export function interpretSetupResult(data: unknown, error: RpcError): SetupOrgResult {
  if (error) {
    if ((error.code && MISSING_SCHEMA_CODES.has(error.code)) || /does not exist|schema cache/i.test(error.message ?? '')) {
      return { status: 'schema_missing' };
    }
    return { status: 'failed', error: error.message || error.code || 'unknown error' };
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (
      isUUID(d.org_id) &&
      typeof d.slug === 'string' && d.slug &&
      (d.kind === 'artist' || d.kind === 'label') &&
      typeof d.created === 'boolean'
    ) {
      return { status: d.created ? 'created' : 'exists', orgId: d.org_id, slug: d.slug, kind: d.kind };
    }
  }
  return { status: 'failed', error: `unexpected ${SETUP_ORG_RPC} answer` };
}

export const SETUP_NOT_READY = 'Organization setup is not available yet (migrations 189 and 192 have not been applied).';
