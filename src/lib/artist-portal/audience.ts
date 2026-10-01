/**
 * Portals shaped by role. One portal link per contact, as before; what it
 * puts first follows the contact's MAIN role (lib/contacts/roles):
 *
 *   artist    beats first — the portal as it always was
 *   producer  loops first, then beats; stems marked, one click to ask for them
 *   label     toplines and songs first; projects read as packs, each opened
 *             with the producer's pitch for that label (mig 135)
 *
 * The extra role never changes the portal: someone who raps and produces gets
 * the portal of the role the producer called their main one. Anyone without
 * an artist/producer/label role gets the artist portal. Only wording and
 * order change — membership, downloads and comments are decided exactly as
 * before (membership.ts), so a shape can never show more than the portal holds.
 */

import { groupOfCategory } from '@/lib/contacts/roles';

export type PortalAudience = 'artist' | 'producer' | 'label';

export function portalAudience(category: string | null | undefined): PortalAudience {
  const g = groupOfCategory(category);
  return g === 'producer' || g === 'label' ? g : 'artist';
}

export interface PortalShape {
  /** Track types in the order the library lists them; unlisted types go last. */
  typeOrder: string[];
  /** The Library tab's name. */
  libraryLabel: string;
  /** One line under the greeting. */
  tagline: string;
  /** What a project is called here. */
  projectNoun: { one: string; many: string };
  /** Producers can ask for a track's stems from its row. */
  askForStems: boolean;
}

export const PORTAL_SHAPES: Record<PortalAudience, PortalShape> = {
  artist: {
    typeOrder: ['beat', 'instrumental', 'song', 'topline', 'loop', 'remix'],
    libraryLabel: 'Library',
    tagline: 'Beats picked for you. Tap Interested on the ones you want to write to.',
    projectNoun: { one: 'project', many: 'Projects' },
    askForStems: false,
  },
  producer: {
    typeOrder: ['loop', 'beat', 'instrumental', 'topline', 'song', 'remix'],
    libraryLabel: 'Loops & beats',
    tagline: 'Loops and beats to build on. Stems are one request away.',
    projectNoun: { one: 'project', many: 'Projects' },
    askForStems: true,
  },
  label: {
    typeOrder: ['topline', 'song', 'beat', 'instrumental', 'loop', 'remix'],
    libraryLabel: 'Toplines & songs',
    tagline: 'Toplines, songs and packs for your roster.',
    projectNoun: { one: 'pack', many: 'Packs' },
    askForStems: false,
  },
};

/** Stable: within a type the tracks keep the order they came in (project position). */
export function orderForAudience<T extends { type: string }>(tracks: readonly T[], audience: PortalAudience): T[] {
  const order = PORTAL_SHAPES[audience].typeOrder;
  const rank = (t: string) => { const i = order.indexOf(t); return i === -1 ? order.length : i; };
  return tracks.map((t, i) => ({ t, i })).sort((a, b) => rank(a.t.type) - rank(b.t.type) || a.i - b.i).map(({ t }) => t);
}

/** The request a producer's "Ask for stems" sends (through the portal's Messages). */
export function stemsRequestBody(trackTitle: string): string {
  return `Could I get the stems for “${trackTitle}”?`;
}

/** A pitch note as the portal shows it: trimmed, empty = none. */
export function cleanPitchNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, 2000) : null;
}
