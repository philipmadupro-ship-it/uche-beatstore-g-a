/**
 * The one address for "open this track in the studio".
 *
 * `/studio` reads `?track=<id>` on mount and preselects that track once its
 * track list resolves (`components/studio/StudioWorkstation`). The details
 * drawer, the track page and every Library ⋯ menu link here, so the query
 * name lives in one place rather than in four hand-built template strings.
 */
export function studioHref(trackId: string): string {
  return `/studio?track=${encodeURIComponent(trackId)}`;
}
