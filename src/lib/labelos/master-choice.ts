/**
 * Which recording goes out as a song on a release (LABEL-55, 17 R1). Pure.
 *
 * The options are the ones 144's trigger accepts (`RELEASE_MASTER_RELATIONS`
 * plus the song's own mix): a track the song links to as `master`,
 * `instrumental` or `version`, or the song itself. The DEFAULT is the single
 * linked `master`; with none, or with several, nobody guesses — the person
 * adding the track is asked. The song's own mix is never a silent default
 * (the masters gate reads it as "no separate master" and wants a decision).
 *
 * The server holds every rule again (`checkItemTracks`, the trigger); this
 * decides only what the chooser offers and pre-selects.
 */
import { RELEASE_MASTER_RELATIONS } from './releases';

export type MasterRelation = 'self' | (typeof RELEASE_MASTER_RELATIONS)[number];

export type MasterOption = { id: string; relation: MasterRelation };
export type MasterCandidate = MasterOption & { title: string };

export type MasterChoice = {
  options: MasterOption[];
  defaultId: string | null;
  /** True when the person must pick (no linked master, or more than one). */
  ask: boolean;
};

const ORDER: Record<MasterRelation, number> = { master: 0, self: 1, instrumental: 2, version: 3 };

export function masterChoice(
  songId: string,
  links: ReadonlyArray<{ from_track_id: string; to_track_id: string; relation: string }>,
): MasterChoice {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const relations = RELEASE_MASTER_RELATIONS as readonly string[];
  const options: MasterOption[] = [];
  for (const l of links) {
    if (!same(l.from_track_id, songId) || !relations.includes(l.relation)) continue;
    if (options.some((o) => same(o.id, l.to_track_id))) continue;
    options.push({ id: l.to_track_id, relation: l.relation as MasterRelation });
  }
  options.push({ id: songId, relation: 'self' });
  // Stable within a relation: masters first, then the song's own mix, then the rest.
  options.sort((a, b) => ORDER[a.relation] - ORDER[b.relation]);
  const masters = options.filter((o) => o.relation === 'master');
  const defaultId = masters.length === 1 ? masters[0].id : null;
  return { options, defaultId, ask: defaultId === null };
}

export const MASTER_RELATION_LABEL: Record<MasterRelation, string> = {
  master: 'Master',
  self: 'Own mix',
  instrumental: 'Instrumental',
  version: 'Version',
};
