/**
 * Which creator profile the storefront belongs to.
 *
 * The app is single-producer, but `creator_profiles` reliably accumulates
 * extra rows: repeated OAuth round-trips and dev seeding each mint one, and
 * every one of them is a valid-looking profile with nothing in it.
 *
 * The old rule was "order by display_name, nulls last, take one". That works
 * only while exactly one row has a name. When every row's `display_name` is
 * null — which is the normal state for a producer who never filled in their
 * profile — the ordering has nothing to sort on and the winner is whatever
 * Postgres returns first. The catalogue query is then scoped to that
 * `user_id`, so the storefront silently shows an empty catalogue while the
 * producer's real one sits under the other row. The prices, bio and accent
 * colour come from the wrong row too.
 *
 * Ownership of the catalogue is the fact that actually identifies the
 * producer, so that is what decides it. Naming is only a tie-break.
 */
export interface OwnerCandidate {
  user_id: string;
  display_name?: string | null;
  /** Tracks currently on the storefront. */
  listed_tracks: number;
  /** Tracks owned at all — a producer mid-setup has these but none listed. */
  total_tracks: number;
  /** Whether the row carries default artwork, which only a used profile has. */
  has_artwork?: boolean;
}

/**
 * Rank candidates best-first.
 *
 * Every comparison is total and deterministic, ending on `user_id`, so two
 * requests never disagree about who the producer is — an unstable answer would
 * make the catalogue flicker between populated and empty as the CDN cache
 * turned over.
 */
export function rankStoreOwners(candidates: readonly OwnerCandidate[]): OwnerCandidate[] {
  return candidates.slice().sort((a, b) => {
    // What a visitor can actually buy is the strongest signal.
    if (a.listed_tracks !== b.listed_tracks) return b.listed_tracks - a.listed_tracks;
    // Nothing listed yet: whoever owns the catalogue is still the producer.
    if (a.total_tracks !== b.total_tracks) return b.total_tracks - a.total_tracks;
    // A profile someone has customised beats an untouched one.
    const artwork = Number(Boolean(b.has_artwork)) - Number(Boolean(a.has_artwork));
    if (artwork !== 0) return artwork;
    const named = Number(Boolean(b.display_name)) - Number(Boolean(a.display_name));
    if (named !== 0) return named;
    return a.user_id.localeCompare(b.user_id);
  });
}

export function pickStoreOwner(candidates: readonly OwnerCandidate[]): OwnerCandidate | null {
  if (candidates.length === 0) return null;
  return rankStoreOwners(candidates)[0];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Resolve the storefront's owner against the database.
 *
 * Counts are `head: true` so nothing but a number crosses the wire, and the
 * candidate list is a handful of rows in the worst case. Any failure returns
 * null and the caller falls back to its previous behaviour rather than
 * serving an error page.
 */
export async function resolveStoreOwner(admin: any): Promise<OwnerCandidate | null> {
  try {
    const { data, error } = await admin
      .from('creator_profiles')
      .select('user_id, display_name, default_artwork_url')
      .limit(20);
    if (error || !data || data.length === 0) return null;
    if (data.length === 1) {
      return {
        user_id: data[0].user_id,
        display_name: data[0].display_name ?? null,
        listed_tracks: 0,
        total_tracks: 0,
        has_artwork: Boolean(data[0].default_artwork_url),
      };
    }

    const candidates = await Promise.all(
      (data as any[]).map(async (row) => {
        const [listed, total] = await Promise.all([
          admin
            .from('tracks')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', row.user_id)
            .eq('store_listed', true),
          admin.from('tracks').select('id', { count: 'exact', head: true }).eq('user_id', row.user_id),
        ]);
        return {
          user_id: row.user_id as string,
          display_name: (row.display_name ?? null) as string | null,
          listed_tracks: listed?.count ?? 0,
          total_tracks: total?.count ?? 0,
          has_artwork: Boolean(row.default_artwork_url),
        };
      }),
    );

    return pickStoreOwner(candidates);
  } catch {
    return null;
  }
}
