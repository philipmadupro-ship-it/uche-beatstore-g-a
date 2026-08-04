import 'server-only';

/**
 * Server-side catalogue reader for discovery pages and the sitemap.
 *
 * Both need the same thing — every store-listed track with its tags — and both
 * run on the server at request/build time. Sharing one reader means the sitemap
 * can never advertise a page the landing route would 404, which is the failure
 * that makes search engines distrust a site.
 */

import { createServiceClient } from '@/lib/auth/ownership';
import { buildDiscoveryTerms, type DiscoveryTrack, type DiscoveryTerm } from './discovery';

export interface StoreCatalogue {
  tracks: DiscoveryTrack[];
  terms: DiscoveryTerm[];
  producerName: string;
}

/** Empty catalogue — used whenever the database is unreachable or unconfigured. */
const EMPTY: StoreCatalogue = { tracks: [], terms: [], producerName: 'Beat store' };

/**
 * Load the public catalogue and the discovery terms it supports.
 *
 * Returns an EMPTY catalogue rather than throwing on failure. A sitemap that
 * 500s is worse than a sitemap listing only the static routes: crawlers treat
 * repeated errors as a signal to back off entirely.
 */
export async function loadStoreCatalogue(): Promise<StoreCatalogue> {
  try {
    const admin = createServiceClient();

    const [{ data: trackRows }, { data: profile }] = await Promise.all([
      admin
        .from('tracks')
        .select('id, title, type, bpm, track_tags(tag, category)')
        .eq('store_listed', true),
      admin
        .from('creator_profiles')
        .select('display_name')
        .not('display_name', 'is', null)
        .limit(1)
        .maybeSingle(),
    ]);

    const tracks: DiscoveryTrack[] = (trackRows ?? []).map((row) => {
      const r = row as {
        id: string; title: string; type?: string | null; bpm?: number | null;
        track_tags?: Array<{ tag: string; category?: string | null }> | null;
      };
      return {
        id: r.id,
        title: r.title,
        type: r.type ?? null,
        bpm: r.bpm ?? null,
        tags: r.track_tags ?? [],
      };
    });

    return {
      tracks,
      terms: buildDiscoveryTerms(tracks),
      producerName: (profile as { display_name?: string } | null)?.display_name || 'Beat store',
    };
  } catch {
    return EMPTY;
  }
}
