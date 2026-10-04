/**
 * The buyer's "My beats" workspace — one list of every beat that is theirs or
 * that they have asked for, in the shape the library uses (filter, sort, play,
 * select), built from rows the buyer account already reads.
 *
 *   owned      a license purchase, or a track of a bundle they bought, whose
 *              access has not been revoked
 *   requested  an offer they made on a beat they do not own
 *
 * "Requested" is deliberately offers only: it is the one request a buyer can
 * make today that leaves a row (`buyer_offers`, mig 068).
 *
 * Everything here is pure so the rules are Vitest-covered rather than hiding in
 * the page — see "Pure logic goes in lib/" in CLAUDE.md.
 *
 * What leaves this module is built field by field, never by spreading a row:
 * no `wav_url`, `audio_url` or `preview_url` can ride along.
 */

import type { Track, TrackType } from '@/lib/types';
import { buyerPlayerTrack } from '@/lib/store/buyer-playback';

export type BuyerBeatStatus = 'owned' | 'requested';
export type BuyerBeatSort = 'recent' | 'title' | 'bpm' | 'key';
export type BuyerBeatStatusFilter = 'all' | BuyerBeatStatus;

export interface BuyerBeatTrackRow {
  id: string;
  title: string | null;
  cover_url: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  store_listed?: boolean | null;
}

export interface BuyerBeatLicenseInput {
  created_at: string | null;
  access_revoked?: boolean;
  download_url: string | null;
  items: Array<{ track_id: string; license_type?: string | null }>;
}

export interface BuyerBeatBundleInput {
  project_id: string;
  created_at: string | null;
  access_revoked?: boolean;
  download_url: string | null;
}

export interface BuyerBeatOfferInput {
  id: string;
  track_id: string | null;
  track_title: string | null;
  offered_price_usd: number | string | null;
  status: string | null;
  created_at: string | null;
}

export interface BuyerBeatOffer {
  status: string;
  price_usd: number;
}

export interface BuyerBeat {
  id: string;
  title: string;
  cover_url: string | null;
  type: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  duration_seconds: number | null;
  status: BuyerBeatStatus;
  /** ISO time of the purchase, or of the offer for a requested beat. */
  since: string | null;
  /** License tier of the latest purchase; null for a bundle track or a request. */
  license: string | null;
  offer: BuyerBeatOffer | null;
  /** The storefront lists it, so `/store/[id]` exists to link to. */
  listed: boolean;
  /**
   * `/api/store/me/preview/[id]` will stream it: the buyer owns it (even after
   * an exclusive sale delisted it) or the store still lists it.
   */
  playable: boolean;
  /** Owned, or listed: the same rule `/api/store/me` enforces on write. */
  canAddToProject: boolean;
  /** Where the delivery lives (download page / bundle page) when owned. */
  openUrl: string | null;
  /** False when the beat was delisted and is not owned: title only. */
  available: boolean;
}

export const BUYER_PROJECT_MAX_TRACKS = 50;

const timeOf = (iso: string | null | undefined): number => {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
};

export function formatBeatKey(key: string | null, scale: string | null): string | null {
  if (!key) return null;
  return `${key}${scale === 'minor' ? 'm' : ''}`;
}

interface OwnedClaim {
  at: number;
  since: string | null;
  license: string | null;
  openUrl: string | null;
}

/**
 * Merge purchases, bundle tracks and offers into one row per track.
 *
 * - A refunded / disputed / revoked purchase or bundle owns nothing.
 * - An owned beat with an offer on it stays `owned`; the offer rides along.
 * - A beat's metadata shows only when it is listed or owned (the same rule as
 *   `visibleBuyerLibraryTracks`). A delisted beat that is merely requested
 *   keeps the title the offer stored and nothing else.
 */
export function buildBuyerBeats(input: {
  licenses: BuyerBeatLicenseInput[];
  bundles: BuyerBeatBundleInput[];
  /** `project_tracks` rows for the bundles above. */
  bundleTracks: Array<{ project_id: string; track_id: string }>;
  offers: BuyerBeatOfferInput[];
  tracks: BuyerBeatTrackRow[];
}): BuyerBeat[] {
  const owned = new Map<string, OwnedClaim>();
  const claim = (trackId: string, next: OwnedClaim) => {
    const prev = owned.get(trackId);
    if (!prev || next.at > prev.at) owned.set(trackId, next);
  };

  for (const lic of input.licenses) {
    if (lic.access_revoked) continue;
    for (const item of lic.items) {
      if (!item.track_id) continue;
      claim(item.track_id, {
        at: timeOf(lic.created_at),
        since: lic.created_at,
        license: item.license_type?.trim() || null,
        openUrl: lic.download_url,
      });
    }
  }

  const activeBundles = new Map(
    input.bundles.filter((b) => !b.access_revoked).map((b) => [b.project_id, b]),
  );
  for (const row of input.bundleTracks) {
    const bundle = activeBundles.get(row.project_id);
    if (!bundle || !row.track_id) continue;
    claim(row.track_id, {
      at: timeOf(bundle.created_at),
      since: bundle.created_at,
      license: null,
      openUrl: bundle.download_url,
    });
  }

  const latestOffer = new Map<string, BuyerBeatOfferInput>();
  for (const offer of input.offers) {
    if (!offer.track_id) continue;
    const prev = latestOffer.get(offer.track_id);
    if (!prev || timeOf(offer.created_at) > timeOf(prev.created_at)) latestOffer.set(offer.track_id, offer);
  }

  const trackById = new Map(input.tracks.map((t) => [t.id, t]));
  const ids = new Set<string>([...owned.keys(), ...latestOffer.keys()]);
  const beats: BuyerBeat[] = [];

  for (const id of ids) {
    const claimed = owned.get(id) ?? null;
    const offer = latestOffer.get(id) ?? null;
    const row = trackById.get(id) ?? null;
    const listed = row?.store_listed === true;
    // Metadata is allowed for a listed beat or one this buyer owns.
    const visible = row && (listed || claimed) ? row : null;

    const price = Number(offer?.offered_price_usd ?? 0);
    beats.push({
      id,
      title: visible?.title?.trim() || offer?.track_title?.trim() || 'Untitled beat',
      cover_url: visible?.cover_url ?? null,
      type: visible?.type ?? null,
      bpm: visible?.bpm ?? null,
      key: visible?.key ?? null,
      scale: visible?.scale ?? null,
      duration_seconds: visible?.duration_seconds ?? null,
      status: claimed ? 'owned' : 'requested',
      since: claimed ? claimed.since : offer?.created_at ?? null,
      license: claimed?.license ?? null,
      offer: offer ? { status: offer.status ?? 'pending', price_usd: Number.isFinite(price) ? price : 0 } : null,
      listed,
      playable: Boolean(claimed) || listed,
      canAddToProject: Boolean(claimed) || listed,
      openUrl: claimed?.openUrl ?? null,
      available: Boolean(visible),
    });
  }

  return sortBuyerBeats(beats, 'recent');
}

export interface BuyerBeatFilters {
  status?: BuyerBeatStatusFilter;
  query?: string;
}

export function filterBuyerBeats(beats: BuyerBeat[], filters: BuyerBeatFilters): BuyerBeat[] {
  const status = filters.status ?? 'all';
  const words = (filters.query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return beats.filter((b) => {
    if (status !== 'all' && b.status !== status) return false;
    if (words.length === 0) return true;
    const haystack = [
      b.title,
      b.type,
      formatBeatKey(b.key, b.scale),
      b.key ? `${b.key} ${b.scale ?? ''}` : null,
      b.bpm ? `${b.bpm} bpm` : null,
      b.license,
    ].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

const byTitle = (a: BuyerBeat, b: BuyerBeat) =>
  a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

/** Returns a new array; never mutates. A missing BPM / key sorts last. */
export function sortBuyerBeats(beats: BuyerBeat[], sort: BuyerBeatSort): BuyerBeat[] {
  const out = [...beats];
  switch (sort) {
    case 'title':
      return out.sort(byTitle);
    case 'bpm':
      return out.sort((a, b) => {
        if (a.bpm == null && b.bpm == null) return byTitle(a, b);
        if (a.bpm == null) return 1;
        if (b.bpm == null) return -1;
        return a.bpm - b.bpm || byTitle(a, b);
      });
    case 'key':
      return out.sort((a, b) => {
        const ka = formatBeatKey(a.key, a.scale);
        const kb = formatBeatKey(b.key, b.scale);
        if (!ka && !kb) return byTitle(a, b);
        if (!ka) return 1;
        if (!kb) return -1;
        return ka.localeCompare(kb) || byTitle(a, b);
      });
    case 'recent':
    default:
      return out.sort((a, b) => timeOf(b.since) - timeOf(a.since) || byTitle(a, b));
  }
}

export interface OwnedSound {
  count: number;
  bpmRange: [number, number] | null;
  topKey: string | null;
  topType: string | null;
}

function mostCommon(values: string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [v, n] of counts) {
    // Ties break alphabetically so the line never flickers between renders.
    if (n > bestCount || (n === bestCount && best !== null && v < best)) { best = v; bestCount = n; }
  }
  return best;
}

/**
 * What the buyer's owned beats have in common — the whole of the
 * "personalised" part of the workspace. Derived from ownership alone: there is
 * no stored role and no asking the buyer to declare one.
 */
export function ownedSound(beats: BuyerBeat[]): OwnedSound | null {
  const mine = beats.filter((b) => b.status === 'owned' && b.available);
  if (mine.length === 0) return null;
  const bpms = mine.map((b) => b.bpm).filter((n): n is number => typeof n === 'number' && n > 0);
  const keys = mine.map((b) => formatBeatKey(b.key, b.scale)).filter((k): k is string => Boolean(k));
  const types = mine.map((b) => b.type).filter((t): t is string => Boolean(t));
  return {
    count: mine.length,
    bpmRange: bpms.length > 0 ? [Math.min(...bpms), Math.max(...bpms)] : null,
    topKey: mostCommon(keys),
    topType: mostCommon(types),
  };
}

/** One honest line, or null when there is nothing to say yet. */
export function describeOwnedSound(sound: OwnedSound | null): string | null {
  if (!sound) return null;
  const parts: string[] = [];
  if (sound.bpmRange) {
    const [lo, hi] = sound.bpmRange;
    parts.push(lo === hi ? `${lo} BPM` : `${lo}–${hi} BPM`);
  }
  if (sound.topKey) parts.push(`mostly ${sound.topKey}`);
  if (sound.topType) parts.push(`${sound.topType}s`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The ids a "Create project" may send: selectable rows only, once each, capped.
 * The route re-checks every one — this only keeps the request well-formed.
 */
export function projectTrackIds(beats: BuyerBeat[], selected: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const b of beats) {
    if (ids.length >= BUYER_PROJECT_MAX_TRACKS) break;
    if (selected.has(b.id) && b.canAddToProject) ids.push(b.id);
  }
  return ids;
}

/** Identity the account page's player asks the buyer preview route with. */
const SESSION_IDENTITY = 'session=1';

/**
 * The persistent player's input for a row. The source is the buyer's preview
 * route (`lib/store/buyer-playback`), which streams the public preview clip
 * and never a master — and which, unlike the public route, still serves a beat
 * the buyer owns after an exclusive sale delisted it. Null when the row cannot
 * stream (a request on a beat that is no longer listed), so it shows no Play.
 */
export function beatToPlayerTrack(beat: BuyerBeat): Track | null {
  if (!beat.playable) return null;
  return buyerPlayerTrack(
    {
      id: beat.id,
      title: beat.title,
      type: beat.type,
      cover_url: beat.cover_url,
      bpm: beat.bpm,
      key: beat.key,
      scale: beat.scale,
      duration_seconds: beat.duration_seconds,
    },
    SESSION_IDENTITY,
  );
}
