/**
 * Contact roles: which tab of /contacts a contact belongs in.
 *
 * A contact has ONE main role — the existing `category` — and may have one
 * extra role (`secondary_category`, mig 134): an artist who also produces
 * shows in both Artists and Producers, main first. Categories map onto four
 * groups; the tab decides what is useful for the people in it:
 *   artist    beats, songs, the workspace and portal (decisions, messages)
 *   producer  loops and collaborations
 *   label     toplines and packs
 *   other     everyone else (buyers, friends, press…)
 * A contact linked to a project or given a portal, with no producer/label
 * role, counts as an artist — that is how the Artists view worked before
 * roles, and an unlabelled collaborator must not vanish from it.
 */

export const ROLE_GROUPS = ['artist', 'producer', 'label', 'other'] as const;
export type RoleGroup = (typeof ROLE_GROUPS)[number];

export const ROLE_GROUP_LABEL: Record<RoleGroup, string> = {
  artist: 'Artists', producer: 'Producers', label: 'Labels & A&R', other: 'Other contacts',
};

/** The categories the contact form offers, main or extra. */
export const CONTACT_CATEGORIES = [
  'artist', 'rapper', 'producer', 'engineer', 'label', 'a&r', 'manager',
  'friend', 'dj', 'curator', 'press', 'buyer', 'other',
] as const;

const GROUP_OF: Record<string, RoleGroup> = {
  artist: 'artist', rapper: 'artist', singer: 'artist', songwriter: 'artist', topliner: 'artist',
  producer: 'producer', engineer: 'producer', beatmaker: 'producer',
  label: 'label', 'a&r': 'label', ar: 'label', manager: 'label', publisher: 'label',
};

export function groupOfCategory(category: string | null | undefined): RoleGroup | null {
  const c = (category ?? '').trim().toLowerCase();
  if (!c) return null;
  return GROUP_OF[c] ?? 'other';
}

export interface RoleInput {
  category?: string | null;
  secondary_category?: string | null;
}

/**
 * The tabs a contact appears in, main first, at most two. `inWorkspace`
 * (linked to a project or holding a portal) makes an otherwise
 * artist-less, producer-less, label-less contact an artist.
 */
export function contactGroups(c: RoleInput, inWorkspace = false): RoleGroup[] {
  const main = groupOfCategory(c.category);
  const extra = groupOfCategory(c.secondary_category);
  const out: RoleGroup[] = [];
  for (const g of [main, extra]) if (g && !out.includes(g)) out.push(g);
  const specific = out.filter((g) => g !== 'other');
  if (inWorkspace && !specific.some((g) => g === 'artist' || g === 'producer' || g === 'label')) {
    return ['artist', ...specific];
  }
  if (specific.length) return specific;
  return ['other'];
}

/** Contacts per tab. A contact with two roles is in two tabs. */
export function splitByRole<T extends RoleInput & { id: string }>(
  contacts: readonly T[],
  workspaceIds: ReadonlySet<string>,
): Record<RoleGroup, T[]> {
  const out: Record<RoleGroup, T[]> = { artist: [], producer: [], label: [], other: [] };
  for (const c of contacts) for (const g of contactGroups(c, workspaceIds.has(c.id))) out[g].push(c);
  return out;
}

/** "also Producer" — the badge a contact carries in the tab of its other role. */
export function otherRoleBadge(c: RoleInput, inWorkspace: boolean, tab: RoleGroup): string | null {
  const groups = contactGroups(c, inWorkspace).filter((g) => g !== tab && g !== 'other');
  if (!groups.length) return null;
  return `also ${ROLE_GROUP_LABEL[groups[0]].replace(/s$/, '').replace(/s & A&R$/, ' / A&R')}`;
}

/** What each tab offers to send, in order (the Send Beat modal presets). */
export const ROLE_SENDS: Record<RoleGroup, Array<{ id: string; label: string; mode: 'tracks' | 'project'; types?: string[] }>> = {
  artist: [{ id: 'beats', label: 'Send beats', mode: 'tracks', types: ['beat', 'instrumental'] }],
  producer: [{ id: 'loops', label: 'Send loops', mode: 'tracks', types: ['loop'] }],
  label: [
    { id: 'toplines', label: 'Send toplines', mode: 'tracks', types: ['topline', 'song'] },
    { id: 'pack', label: 'Send a pack', mode: 'project' },
  ],
  other: [{ id: 'tracks', label: 'Send tracks', mode: 'tracks' }],
};

/** Counts per track type from what was sent to a contact (beat_sends.track_ids). */
export function sentByType(
  sends: ReadonlyArray<{ track_ids: string[] | null; kind?: string | null }>,
  typeOf: ReadonlyMap<string, string | null>,
): { beats: number; loops: number; toplines: number; songs: number; packs: number } {
  const seen = new Set<string>();
  const out = { beats: 0, loops: 0, toplines: 0, songs: 0, packs: 0 };
  for (const s of sends) {
    if (s.kind === 'project') out.packs += 1;
    for (const id of s.track_ids ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const t = typeOf.get(id);
      if (t === 'loop') out.loops += 1;
      else if (t === 'topline') out.toplines += 1;
      else if (t === 'song') out.songs += 1;
      else if (t) out.beats += 1;
    }
  }
  return out;
}
