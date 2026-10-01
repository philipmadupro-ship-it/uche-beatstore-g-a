/**
 * Labels the command palette adds to search results so a hit says what it is:
 *   MIDNIGHT (vocal)   SONG · Artist #1
 *   Artist #1          ARTIST
 *
 * A song's artist is the contact credited on it (track_collaborators with a
 * contact) and otherwise the artist linked to a project the song is in. Pure
 * so the precedence is tested; the route only fetches the rows.
 */

export interface SongArtistInput {
  songIds: readonly string[];
  credits: ReadonlyArray<{ track_id: string; contact_id: string | null }>;
  projectTracks: ReadonlyArray<{ project_id: string; track_id: string }>;
  links: ReadonlyArray<{ project_id: string; contact_id: string; role: string; created_at: string }>;
  contactNames: ReadonlyMap<string, string>;
}

export function songArtistNames(input: SongArtistInput): Map<string, string> {
  const out = new Map<string, string>();
  const songSet = new Set(input.songIds);
  for (const c of input.credits) {
    if (!songSet.has(c.track_id) || !c.contact_id || out.has(c.track_id)) continue;
    const name = input.contactNames.get(c.contact_id);
    if (name) out.set(c.track_id, name);
  }
  // Artists before other roles, earliest link first: the project's main artist.
  const links = [...input.links].sort((a, b) =>
    (a.role === 'artist' ? 0 : 1) - (b.role === 'artist' ? 0 : 1) || a.created_at.localeCompare(b.created_at));
  for (const pt of input.projectTracks) {
    if (!songSet.has(pt.track_id) || out.has(pt.track_id)) continue;
    const link = links.find((l) => l.project_id === pt.project_id && input.contactNames.has(l.contact_id));
    if (link) out.set(pt.track_id, input.contactNames.get(link.contact_id)!);
  }
  return out;
}

/** The palette's second line for a track hit. */
export function trackSearchSub(type: string | null | undefined, artistName: string | null | undefined): string {
  const kind = (type || 'track').toUpperCase();
  return artistName ? `${kind} · ${artistName}` : kind;
}
