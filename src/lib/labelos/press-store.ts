/**
 * The database side of PR and press (LABEL-66). Pure rules live in `press.ts`.
 * Everything here is the service role with an org filter on every query; the
 * routes decide who may call it (member routes: access.ts beside them; public
 * ones: `loadPublicPress`).
 *
 * Migration 184 may not be applied: `pressTablesReady` is a READ probe (a
 * PostgREST insert into a missing table answers an empty 404 that no helper
 * recognises) and the readers throw `PressNotReadyError`, which the routes
 * turn into `{ schemaReady: false }` / 503 naming 184 (members) or the one
 * 404 (the public page).
 */
import type { AdminClient } from '@/lib/auth/ownership';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import { loadEntitlements } from './entitlements-store';
import { effectiveModules, parseDepartmentsOff } from './org-settings';
import { canReadOrgAsset } from './org-assets';
import type { Capability } from './capabilities';
import { loadPublicRelease } from './store-listing-store';
import { publicReleaseView } from './store-listing';
import { toPublicItems } from './store-listing-store';
import {
  PRESS_LIMITS, applyOutreachChange, outreachStage, photoVisible, publicPressView, releasePublishable, shareUsable,
  type OutreachChange, type OutreachStage, type PublicPressView,
} from './press';
import { hashPressToken, newPressToken } from './press-token';

export const NEEDS_184 = 'Press kits need migration 184 applied on Supabase.';
export class PressNotReadyError extends Error {
  constructor() {
    super(NEEDS_184);
  }
}

type DbError = { message: string; code?: string } | null | undefined;
function check(what: string, error: DbError): void {
  if (!error) return;
  if (isMissingSchema(error)) throw new PressNotReadyError();
  throw new Error(`${what}: ${error.message}`);
}

/** Raster images only: what a browser shows in an <img> and nothing a script could ride in. */
export const PRESS_IMAGE_MIME = /^image\/(png|jpeg|webp|gif)$/;

export async function pressTablesReady(admin: AdminClient): Promise<boolean> {
  const res = await admin.from('press_kits').select('id').limit(1);
  if (!res.error) return true;
  if (isMissingSchema(res.error)) return false;
  throw new Error(`press probe: ${res.error.message}`);
}

/** Licensed for `pr` AND not switched off by the owner (`departments_off`): the rule `readMembership` applies. */
export async function orgHasPress(admin: AdminClient, orgId: string): Promise<boolean> {
  const res = await admin.from('organizations').select('id, kind, settings, deleted_at').eq('id', orgId).maybeSingle();
  if (res.error) throw new Error(`org read: ${res.error.message}`);
  const org = res.data as { id: string; kind: string; deleted_at: string | null; settings?: { departments_off?: unknown } | null } | null;
  if (!org || org.deleted_at) return false;
  const licence = await loadEntitlements(admin, { id: org.id, kind: org.kind });
  return effectiveModules(licence.modules, parseDepartmentsOff(org.settings?.departments_off)).has('pr');
}

// ── The kit ──────────────────────────────────────────────────────────────

export type KitRow = {
  id: string;
  release_id: string;
  headline: string | null;
  bio: string | null;
  pre_embargo_note: string | null;
  embargo_at: string | null;
  created_at: string;
  updated_at: string;
};
const KIT_COLUMNS = 'id, release_id, headline, bio, pre_embargo_note, embargo_at, created_at, updated_at';

export async function findKit(admin: AdminClient, org: string, releaseId: string): Promise<KitRow | null> {
  const res = await admin.from('press_kits').select(KIT_COLUMNS).eq('org_id', org).eq('release_id', releaseId).maybeSingle();
  check('kit read', res.error);
  return (res.data as KitRow | null) ?? null;
}

/** The release's kit, made on first write. Two writers racing both end up with the one row. */
export async function ensureKit(admin: AdminClient, org: string, releaseId: string, userId: string): Promise<{ kit: KitRow; created: boolean }> {
  const existing = await findKit(admin, org, releaseId);
  if (existing) return { kit: existing, created: false };
  const ins = await admin.from('press_kits').insert({ org_id: org, release_id: releaseId, created_by: userId }).select(KIT_COLUMNS).single();
  if (ins.error) {
    if (ins.error.code === '23505') {
      const again = await findKit(admin, org, releaseId);
      if (again) return { kit: again, created: false };
    }
    check('kit create', ins.error);
  }
  return { kit: ins.data as KitRow, created: true };
}

export const touchKit = async (admin: AdminClient, org: string, kitId: string) => {
  const res = await admin.from('press_kits').update({ updated_at: new Date().toISOString() }).eq('org_id', org).eq('id', kitId);
  check('kit touch', res.error);
};

export async function updateKit(
  admin: AdminClient, org: string, kitId: string, patch: { headline?: string | null; bio?: string | null; pre_embargo_note?: string | null; embargo_at?: string | null },
): Promise<{ row: KitRow; fields: string[] }> {
  const res = await admin.from('press_kits').update({ ...patch, updated_at: new Date().toISOString() }).eq('org_id', org).eq('id', kitId).select(KIT_COLUMNS).single();
  check('kit update', res.error);
  return { row: res.data as KitRow, fields: Object.keys(patch) };
}

// ── Links ────────────────────────────────────────────────────────────────

/** One past the highest position in use, so a delete never makes the next add tie with a survivor. */
const nextPosition = (rows: readonly { position: number }[]): number => rows.reduce((m, r) => Math.max(m, r.position + 1), 0);

export type LinkRow = { id: string; label: string; url: string; position: number };

export async function addLink(admin: AdminClient, org: string, kitId: string, body: { label: string; url: string }): Promise<LinkRow | 'full'> {
  const existing = await admin.from('press_kit_links').select('position').eq('org_id', org).eq('kit_id', kitId).limit(PRESS_LIMITS.links + 1);
  check('links count', existing.error);
  const taken = (existing.data ?? []) as { position: number }[];
  if (taken.length >= PRESS_LIMITS.links) return 'full';
  const res = await admin.from('press_kit_links').insert({ org_id: org, kit_id: kitId, label: body.label, url: body.url, position: nextPosition(taken) }).select('id, label, url, position').single();
  check('link create', res.error);
  return res.data as LinkRow;
}

export async function removeLink(admin: AdminClient, org: string, kitId: string, linkId: string): Promise<boolean> {
  const res = await admin.from('press_kit_links').delete().eq('org_id', org).eq('kit_id', kitId).eq('id', linkId).select('id');
  check('link delete', res.error);
  return (res.data ?? []).length > 0;
}

// ── Photos ───────────────────────────────────────────────────────────────

export type PhotoRow = { id: string; asset_id: string; caption: string | null; pre_embargo: boolean; position: number };
export type PhotoChoice = { id: string; label: string; mime: string | null };

type AssetRow = { id: string; kind: string; sensitivity: string; label: string | null; file_name: string | null; mime: string | null };

/** Visual, unrestricted raster files of the release's OWN project that this member may open. */
export async function photoChoices(admin: AdminClient, org: string, projectId: string, caps: ReadonlySet<Capability>): Promise<PhotoChoice[]> {
  const res = await admin
    .from('project_assets')
    .select('id, kind, sensitivity, label, file_name, mime')
    .eq('org_id', org)
    .eq('project_id', projectId)
    .in('kind', ['artwork', 'photo'])
    .eq('sensitivity', 'normal')
    .order('created_at', { ascending: false })
    .limit(100);
  if (res.error && !isMissingSchema(res.error)) throw new Error(`photo choices: ${res.error.message}`);
  return ((res.data ?? []) as AssetRow[])
    .filter((a) => !!a.mime && PRESS_IMAGE_MIME.test(a.mime) && canReadOrgAsset(caps, { kind: a.kind, sensitivity: a.sensitivity as 'normal' | 'restricted' }))
    .map((a) => ({ id: a.id, label: a.label || a.file_name || 'Photo', mime: a.mime }));
}

export type AddPhotoResult = PhotoRow | 'full' | 'not_allowed' | 'duplicate';

export async function addPhoto(
  admin: AdminClient, org: string, kitId: string, projectId: string, caps: ReadonlySet<Capability>,
  body: { asset_id: string; caption?: string | null; pre_embargo?: boolean },
): Promise<AddPhotoResult> {
  const allowed = await photoChoices(admin, org, projectId, caps);
  if (!allowed.some((a) => a.id === body.asset_id)) return 'not_allowed';
  const existing = await admin.from('press_kit_photos').select('position').eq('org_id', org).eq('kit_id', kitId).limit(PRESS_LIMITS.photos + 1);
  check('photos count', existing.error);
  const taken = (existing.data ?? []) as { position: number }[];
  if (taken.length >= PRESS_LIMITS.photos) return 'full';
  const res = await admin
    .from('press_kit_photos')
    .insert({ org_id: org, kit_id: kitId, asset_id: body.asset_id, caption: body.caption ?? null, pre_embargo: body.pre_embargo === true, position: nextPosition(taken) })
    .select('id, asset_id, caption, pre_embargo, position')
    .single();
  if (res.error?.code === '23505') return 'duplicate';
  check('photo create', res.error);
  return res.data as PhotoRow;
}

export async function patchPhoto(
  admin: AdminClient, org: string, kitId: string, photoId: string, patch: { caption?: string | null; pre_embargo?: boolean },
): Promise<{ row: PhotoRow; fields: string[] } | null> {
  const res = await admin.from('press_kit_photos').update(patch).eq('org_id', org).eq('kit_id', kitId).eq('id', photoId).select('id, asset_id, caption, pre_embargo, position');
  check('photo update', res.error);
  const row = ((res.data ?? []) as PhotoRow[])[0];
  return row ? { row, fields: Object.keys(patch) } : null;
}

export async function removePhoto(admin: AdminClient, org: string, kitId: string, photoId: string): Promise<boolean> {
  const res = await admin.from('press_kit_photos').delete().eq('org_id', org).eq('kit_id', kitId).eq('id', photoId).select('id');
  check('photo delete', res.error);
  return (res.data ?? []).length > 0;
}

// ── Shares (the grants) ──────────────────────────────────────────────────

export type ShareRow = { id: string; label: string; expires_at: string | null; revoked_at: string | null; view_count: number; last_viewed_at: string | null; created_at: string };
const SHARE_COLUMNS = 'id, label, expires_at, revoked_at, view_count, last_viewed_at, created_at';

/** Makes a grant; the opaque token is returned ONCE and only its hash is stored. */
export async function createShare(
  admin: AdminClient, org: string, kitId: string, userId: string, body: { label: string; expires_at?: string | null },
): Promise<{ share: ShareRow; token: string } | 'full'> {
  const live = await admin.from('press_kit_shares').select('id', { count: 'exact', head: true }).eq('org_id', org).eq('kit_id', kitId).is('revoked_at', null);
  check('shares count', live.error);
  if ((live.count ?? 0) >= PRESS_LIMITS.shares) return 'full';
  const token = newPressToken();
  const res = await admin
    .from('press_kit_shares')
    .insert({ org_id: org, kit_id: kitId, token_hash: hashPressToken(token), label: body.label, expires_at: body.expires_at ?? null, created_by: userId })
    .select(SHARE_COLUMNS)
    .single();
  check('share create', res.error);
  return { share: res.data as ShareRow, token };
}

/** Revokes once: a second call (or an unknown id) answers null. */
export async function revokeShare(admin: AdminClient, org: string, kitId: string, shareId: string, userId: string): Promise<ShareRow | null> {
  const res = await admin
    .from('press_kit_shares')
    .update({ revoked_at: new Date().toISOString(), revoked_by: userId })
    .eq('org_id', org).eq('kit_id', kitId).eq('id', shareId).is('revoked_at', null)
    .select(SHARE_COLUMNS);
  check('share revoke', res.error);
  return ((res.data ?? []) as ShareRow[])[0] ?? null;
}

// ── Outreach ─────────────────────────────────────────────────────────────

export type OutreachRow = { id: string; contact_id: string; sent_at: string | null; opened_at: string | null; replied_at: string | null; coverage_url: string | null };
const OUTREACH_COLUMNS = 'id, contact_id, sent_at, opened_at, replied_at, coverage_url';
export type PressContact = { id: string; name: string; outlet: string | null };

const isPressRole = (c: { category: string | null; secondary_category: string | null }) =>
  [c.category, c.secondary_category].some((x) => (x ?? '').trim().toLowerCase() === 'press');

/** Org contacts whose main or extra role is `press` (any letter case, like the trigger). Whole-org callers only (the route checks). */
export async function pressContacts(admin: AdminClient, org: string): Promise<PressContact[]> {
  const res = await admin.from('contacts').select('id, name, label, category, secondary_category').eq('org_id', org).order('name', { ascending: true }).limit(2000);
  if (res.error) throw new Error(`press contacts: ${res.error.message}`);
  return ((res.data ?? []) as { id: string; name: string; label: string | null; category: string | null; secondary_category: string | null }[])
    .filter(isPressRole)
    .map((c) => ({ id: c.id, name: c.name, outlet: c.label }));
}

export async function listOutreach(admin: AdminClient, org: string, releaseId: string): Promise<OutreachRow[]> {
  const res = await admin.from('press_outreach').select(OUTREACH_COLUMNS).eq('org_id', org).eq('release_id', releaseId).order('created_at', { ascending: true }).order('id', { ascending: true }).limit(500);
  check('outreach read', res.error);
  return (res.data ?? []) as OutreachRow[];
}

export type AddOutreachResult = OutreachRow | 'not_press_contact' | 'duplicate';

export async function addOutreach(admin: AdminClient, org: string, releaseId: string, userId: string, body: { contact_id: string; sent?: boolean }, now: Date): Promise<AddOutreachResult> {
  const one = await admin.from('contacts').select('id, category, secondary_category').eq('org_id', org).eq('id', body.contact_id).maybeSingle();
  if (one.error) throw new Error(`press contact: ${one.error.message}`);
  const found = one.data as { category: string | null; secondary_category: string | null } | null;
  if (!found || !isPressRole(found)) return 'not_press_contact';
  const res = await admin
    .from('press_outreach')
    .insert({ org_id: org, release_id: releaseId, contact_id: body.contact_id, created_by: userId, sent_at: body.sent ? now.toISOString() : null })
    .select(OUTREACH_COLUMNS)
    .single();
  if (res.error?.code === '23505') return 'duplicate';
  check('outreach create', res.error);
  return res.data as OutreachRow;
}

export async function patchOutreach(
  admin: AdminClient, org: string, releaseId: string, id: string, change: OutreachChange, now: Date, retry = true,
): Promise<{ row: OutreachRow; fields: string[] } | null> {
  const cur = await admin.from('press_outreach').select(OUTREACH_COLUMNS).eq('org_id', org).eq('release_id', releaseId).eq('id', id).maybeSingle();
  check('outreach read', cur.error);
  const current = cur.data as OutreachRow | null;
  if (!current) return null;
  const patch = applyOutreachChange(current, change, now);
  if (Object.keys(patch).length === 0) return { row: current, fields: [] };
  // Compare-and-set on the stamps that were read, so two members acting at once cannot leave a row that says
  // "replied" without "sent". A lost race re-reads and plans again, once.
  let q = admin.from('press_outreach').update({ ...patch, updated_at: now.toISOString() }).eq('org_id', org).eq('release_id', releaseId).eq('id', id);
  for (const col of ['sent_at', 'opened_at', 'replied_at'] as const) q = current[col] === null ? q.is(col, null) : q.eq(col, current[col]);
  const res = await q.select(OUTREACH_COLUMNS);
  check('outreach update', res.error);
  const row = ((res.data ?? []) as OutreachRow[])[0];
  if (row) return { row, fields: Object.keys(patch) };
  return retry ? patchOutreach(admin, org, releaseId, id, change, now, false) : null;
}

export async function removeOutreach(admin: AdminClient, org: string, releaseId: string, id: string): Promise<boolean> {
  const res = await admin.from('press_outreach').delete().eq('org_id', org).eq('release_id', releaseId).eq('id', id).select('id');
  check('outreach delete', res.error);
  return (res.data ?? []).length > 0;
}

// ── The member view ──────────────────────────────────────────────────────

export type OwnerPressView = {
  schemaReady: true;
  kit: { headline: string | null; bio: string | null; preEmbargoNote: string | null; embargoAt: string | null } | null;
  links: { id: string; label: string; url: string }[];
  photos: { id: string; label: string; caption: string | null; preEmbargo: boolean }[];
  photoChoices: PhotoChoice[];
  shares: { id: string; label: string; expiresAt: string | null; revokedAt: string | null; views: number; lastViewedAt: string | null; createdAt: string; state: 'live' | 'expired' | 'revoked' }[];
  /** Absent for a caller without the whole-org view. */
  outreach?: { rows: { id: string; contactId: string; name: string; outlet: string | null; stage: OutreachStage; sentAt: string | null; openedAt: string | null; repliedAt: string | null; coverageUrl: string | null }[]; contacts: PressContact[] };
};

export async function loadOwnerView(
  admin: AdminClient, org: string, release: { id: string; projectId: string | null }, kit: KitRow | null,
  opts: { caps: ReadonlySet<Capability>; withOutreach: boolean; now: Date },
): Promise<OwnerPressView> {
  const out: OwnerPressView = {
    schemaReady: true, kit: null, links: [], photos: [], photoChoices: [], shares: [],
  };
  if (kit) {
    out.kit = { headline: kit.headline, bio: kit.bio, preEmbargoNote: kit.pre_embargo_note, embargoAt: kit.embargo_at };
    const [links, photos, shares] = await Promise.all([
      admin.from('press_kit_links').select('id, label, url, position').eq('org_id', org).eq('kit_id', kit.id).order('position', { ascending: true }).order('id', { ascending: true }).limit(PRESS_LIMITS.links),
      admin.from('press_kit_photos').select('id, asset_id, caption, pre_embargo, position').eq('org_id', org).eq('kit_id', kit.id).order('position', { ascending: true }).order('id', { ascending: true }).limit(PRESS_LIMITS.photos),
      admin.from('press_kit_shares').select(SHARE_COLUMNS).eq('org_id', org).eq('kit_id', kit.id).order('created_at', { ascending: false }).limit(100),
    ]);
    check('links read', links.error);
    check('photos read', photos.error);
    check('shares read', shares.error);
    out.links = ((links.data ?? []) as LinkRow[]).map((l) => ({ id: l.id, label: l.label, url: l.url }));
    const photoRows = (photos.data ?? []) as PhotoRow[];
    const names = await assetLabels(admin, org, photoRows.map((p) => p.asset_id));
    out.photos = photoRows.map((p) => ({ id: p.id, label: names.get(p.asset_id) ?? 'Photo', caption: p.caption, preEmbargo: p.pre_embargo }));
    out.shares = ((shares.data ?? []) as ShareRow[]).map((s) => ({
      id: s.id, label: s.label, expiresAt: s.expires_at, revokedAt: s.revoked_at, views: s.view_count ?? 0, lastViewedAt: s.last_viewed_at, createdAt: s.created_at,
      state: s.revoked_at ? 'revoked' : shareUsable(s, opts.now) ? 'live' : 'expired',
    }));
  }
  if (release.projectId) out.photoChoices = await photoChoices(admin, org, release.projectId, opts.caps);
  if (opts.withOutreach) {
    const [rows, contacts] = await Promise.all([listOutreach(admin, org, release.id), pressContacts(admin, org)]);
    const byId = new Map(contacts.map((c) => [c.id, c]));
    out.outreach = {
      contacts,
      rows: rows.map((r) => ({
        id: r.id, contactId: r.contact_id, name: byId.get(r.contact_id)?.name ?? 'Former press contact', outlet: byId.get(r.contact_id)?.outlet ?? null,
        stage: outreachStage(r), sentAt: r.sent_at, openedAt: r.opened_at, repliedAt: r.replied_at, coverageUrl: r.coverage_url,
      })),
    };
  }
  return out;
}

async function assetLabels(admin: AdminClient, org: string, ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const res = await admin.from('project_assets').select('id, label, file_name').eq('org_id', org).in('id', ids.slice(0, PRESS_LIMITS.photos));
  if (res.error) throw new Error(`asset labels: ${res.error.message}`);
  for (const a of (res.data ?? []) as { id: string; label: string | null; file_name: string | null }[]) out.set(a.id, a.label || a.file_name || 'Photo');
  return out;
}

// ── The public entrance ──────────────────────────────────────────────────

export type PublicPressContext = {
  org: string;
  shareId: string;
  kit: KitRow;
  release: { id: string; project_id: string; contact_id: string; title: string; type: string; label_name: string | null; primary_genre: string | null; release_date: string | null; state: string; imported_released: boolean };
};

/**
 * The grant a token opens, or null for EVERY failure: unknown hash, revoked, expired, a kit whose release is gone
 * or cancelled / withdrawn, a deleted or unlicensed org. Read afresh on each request; nothing is cached.
 */
export async function resolvePublicPress(admin: AdminClient, rawToken: string, now: Date): Promise<PublicPressContext | null> {
  const shareRes = await admin
    .from('press_kit_shares')
    .select('id, org_id, kit_id, expires_at, revoked_at')
    .eq('token_hash', hashPressToken(rawToken))
    .maybeSingle();
  if (shareRes.error) {
    if (isMissingSchema(shareRes.error)) return null;
    throw new Error(`share read: ${shareRes.error.message}`);
  }
  const share = shareRes.data as { id: string; org_id: string; kit_id: string; expires_at: string | null; revoked_at: string | null } | null;
  if (!share || !shareUsable(share, now)) return null;
  if (!(await orgHasPress(admin, share.org_id))) return null;
  const kitRes = await admin.from('press_kits').select(KIT_COLUMNS).eq('org_id', share.org_id).eq('id', share.kit_id).maybeSingle();
  check('kit read', kitRes.error);
  const kit = kitRes.data as KitRow | null;
  if (!kit) return null;
  const relRes = await admin
    .from('releases')
    .select('id, project_id, contact_id, title, type, label_name, primary_genre, release_date, state, imported_released')
    .eq('org_id', share.org_id)
    .eq('id', kit.release_id)
    .maybeSingle();
  if (relRes.error) throw new Error(`release read: ${relRes.error.message}`);
  const release = relRes.data as PublicPressContext['release'] | null;
  if (!release || !releasePublishable(release.state)) return null;
  return { org: share.org_id, shareId: share.id, kit, release };
}

/** Counts the view. Approximate by design (a read then a write), never a reason to fail the page. */
export async function noteShareView(admin: AdminClient, org: string, shareId: string, now: Date): Promise<void> {
  const cur = await admin.from('press_kit_shares').select('view_count').eq('org_id', org).eq('id', shareId).maybeSingle();
  if (cur.error || !cur.data) return;
  await admin.from('press_kit_shares').update({ view_count: ((cur.data as { view_count: number }).view_count ?? 0) + 1, last_viewed_at: now.toISOString() }).eq('org_id', org).eq('id', shareId);
}

/** The page for a resolved grant, built by `publicPressView` from nothing but the facts it names. */
export async function buildPublicPress(admin: AdminClient, ctx: PublicPressContext, token: string, now: Date): Promise<PublicPressView> {
  const { org, kit, release } = ctx;
  const [photos, links, items, artist] = await Promise.all([
    admin.from('press_kit_photos').select('id, asset_id, caption, pre_embargo, position').eq('org_id', org).eq('kit_id', kit.id).order('position', { ascending: true }).limit(PRESS_LIMITS.photos),
    admin.from('press_kit_links').select('label, url, position').eq('org_id', org).eq('kit_id', kit.id).order('position', { ascending: true }).limit(PRESS_LIMITS.links),
    admin.from('release_items').select('position, song_track_id, version_title, explicit').eq('org_id', org).eq('release_id', release.id).order('position', { ascending: true }).limit(200),
    admin.from('contacts').select('name').eq('org_id', org).eq('id', release.contact_id).maybeSingle(),
  ]);
  check('photos read', photos.error);
  check('links read', links.error);
  // Only photos whose file is STILL an unrestricted artwork/photo raster image of the release's own project: a photo
  // whose file was restricted or moved since is not listed (its caption included), exactly as its route would refuse it.
  const photoRows = (photos.data ?? []) as { id: string; asset_id: string; caption: string | null; pre_embargo: boolean; position: number }[];
  let validAssets = new Set<string>();
  if (photoRows.length > 0) {
    const a = await admin.from('project_assets').select('id, kind, sensitivity, mime, project_id').eq('org_id', org).in('id', photoRows.map((p) => p.asset_id));
    if (a.error) throw new Error(`photo assets read: ${a.error.message}`);
    validAssets = new Set(
      ((a.data ?? []) as { id: string; kind: string; sensitivity: string | null; mime: string | null; project_id: string }[])
        .filter((x) => x.project_id === release.project_id && ['artwork', 'photo'].includes(x.kind) && x.sensitivity !== 'restricted' && !!x.mime && PRESS_IMAGE_MIME.test(x.mime))
        .map((x) => x.id),
    );
  }
  if (items.error) throw new Error(`items read: ${items.error.message}`);
  if (artist.error) throw new Error(`artist read: ${artist.error.message}`);
  const itemRows = (items.data ?? []) as { position: number; song_track_id: string; version_title: string | null; explicit: boolean }[];
  const titles = new Map<string, string>();
  if (itemRows.length > 0) {
    const t = await admin.from('tracks').select('id, title').eq('org_id', org).in('id', itemRows.map((i) => i.song_track_id));
    if (t.error) throw new Error(`titles read: ${t.error.message}`);
    for (const r of (t.data ?? []) as { id: string; title: string | null }[]) titles.set(r.id, r.title ?? '');
  }

  // Audio only through the store: its own visibility rules (listed, released, consent, finished music) decide.
  let listen: { id: string; title: string; audio_url: string; duration_seconds: number | null }[] | null = null;
  const live = await loadPublicRelease(admin, release.id, now);
  if (live) {
    const view = publicReleaseView(live.row, toPublicItems(live.items));
    listen = view.tracks.map((t) => ({ id: t.id, title: t.title, audio_url: t.audio_url, duration_seconds: t.duration_seconds ?? null }));
  }

  return publicPressView({
    token, now,
    kit,
    release,
    artist: (artist.data as { name: string | null } | null)?.name ?? null,
    photos: photoRows.filter((p) => validAssets.has(p.asset_id)),
    links: (links.data ?? []) as { label: string; url: string; position: number }[],
    tracks: itemRows.map((i) => ({ position: i.position, title: titles.get(i.song_track_id) || 'Untitled', version_title: i.version_title, explicit: i.explicit })),
    listen,
  });
}

/** One photo for a resolved grant: the file reference to stream, or null when this request may not see it. */
export async function publicPhotoSource(admin: AdminClient, ctx: PublicPressContext, photoId: string, now: Date): Promise<{ url: string; file_name: string; mime: string } | null> {
  const p = await admin.from('press_kit_photos').select('asset_id, pre_embargo').eq('org_id', ctx.org).eq('kit_id', ctx.kit.id).eq('id', photoId).maybeSingle();
  check('photo read', p.error);
  const photo = p.data as { asset_id: string; pre_embargo: boolean } | null;
  if (!photo || !photoVisible(photo, ctx.kit.embargo_at, now)) return null;
  const a = await admin.from('project_assets').select('url, file_name, mime, kind, sensitivity, project_id').eq('org_id', ctx.org).eq('id', photo.asset_id).maybeSingle();
  if (a.error) throw new Error(`asset read: ${a.error.message}`);
  const asset = a.data as { url: string; file_name: string | null; mime: string | null; kind: string; sensitivity: string | null; project_id: string } | null;
  if (
    !asset || asset.project_id !== ctx.release.project_id || !['artwork', 'photo'].includes(asset.kind) ||
    asset.sensitivity === 'restricted' || !asset.mime || !PRESS_IMAGE_MIME.test(asset.mime)
  ) return null;
  return { url: asset.url, file_name: asset.file_name ?? 'photo', mime: asset.mime };
}
