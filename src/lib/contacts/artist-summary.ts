/**
 * One artist, summarised for the Artists card view on /contacts:
 *
 *   [avatar] Artist #1        Working together
 *            New EP (cover)   2 interested · 1 recording
 *            Played 14× · 3 downloads · portal opened 2d ago · 3 to notify
 *
 * Pure: the route fetches every artist's rows in a handful of owner-filtered
 * batch queries and hands one contact's slice here, so the card agrees with
 * the workspace (same relationship rule, same notify count, same engagement
 * window) without one workspace load per card.
 */

import { isDecision, MOVING_DECISIONS, type Decision } from './decisions';
import { deriveRelationshipStage, type Relationship } from './relationship';
import { countUnnotified, type PortalFileRow, type PortalProjectRow, type PortalTrackRow } from '@/lib/artist-portal/new-items';

export interface ArtistSummaryInput {
  contact: { id: string; name: string; avatar_url: string | null; crm_status: string | null };
  links: Array<{ project_id: string; in_portal: boolean; created_at: string; last_notified_at: string | null }>;
  projects: Array<{ id: string; name: string | null; cover_url: string | null; status: string | null }>;
  portal: { revoked_at: string | null; last_viewed_at: string | null } | null;
  decisions: Array<string | null>;
  sends: Array<{ opened_at: string | null; link_clicked_at: string | null }>;
  /** contact_activity rows in the engagement window. */
  activity: Array<{ kind: string }>;
  shareCount: number;
  portalTracks: PortalTrackRow[];
  portalFiles: PortalFileRow[];
}

export interface ArtistSummary {
  contact: { id: string; name: string; avatar_url: string | null };
  relationship: Relationship;
  /** The most recently linked project that is not archived. */
  activeProject: { id: string; name: string; cover_url: string | null } | null;
  projectCount: number;
  decisions: Partial<Record<Decision, number>>;
  moving: number;
  plays: number;
  downloads: number;
  portal: { live: boolean; lastViewedAt: string | null } | null;
  notifyCount: number;
}

export function summarizeArtist(input: ArtistSummaryInput): ArtistSummary {
  const projectById = new Map(input.projects.map((p) => [p.id, p]));
  const linked = input.links
    .filter((l) => projectById.has(l.project_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const active = linked.map((l) => projectById.get(l.project_id)!).filter((p) => p.status !== 'archived');

  const decisions: Partial<Record<Decision, number>> = {};
  let moving = 0;
  const typed = input.decisions.map((d) => (isDecision(d) ? d : null));
  for (const d of typed) {
    if (!d) continue;
    decisions[d] = (decisions[d] ?? 0) + 1;
    if (MOVING_DECISIONS.includes(d)) moving += 1;
  }

  const plays = input.activity.filter((a) => a.kind === 'track_played').length;
  const downloads = input.activity.filter((a) => a.kind === 'track_downloaded' || a.kind === 'file_downloaded').length;
  const visits = input.activity.filter((a) => a.kind === 'portal_opened').length;

  const relationship = deriveRelationshipStage({
    contacted: input.sends.length > 0 || !!input.portal || input.shareCount > 0,
    engaged: input.sends.some((s) => s.opened_at || s.link_clicked_at) || visits > 0 || plays > 0,
    decisions: typed,
    activeLinkedProjects: active.length,
    crmStatus: input.contact.crm_status,
  });

  const portalLinks: PortalProjectRow[] = input.links
    .filter((l) => l.in_portal && projectById.has(l.project_id) && projectById.get(l.project_id)!.status !== 'archived')
    .map((l) => ({ projectId: l.project_id, linkedAt: l.created_at, lastNotifiedAt: l.last_notified_at }));
  const inPortal = new Set(portalLinks.map((l) => l.projectId));
  const live = !!input.portal && !input.portal.revoked_at;
  const notify = live
    ? countUnnotified(
        portalLinks,
        input.portalTracks.filter((t) => inPortal.has(t.projectId)),
        input.portalFiles.filter((f) => inPortal.has(f.projectId)),
      ).total
    : 0;

  const top = active[0] ?? null;
  return {
    contact: { id: input.contact.id, name: input.contact.name, avatar_url: input.contact.avatar_url },
    relationship,
    activeProject: top ? { id: top.id, name: top.name ?? 'Untitled project', cover_url: top.cover_url } : null,
    projectCount: linked.length,
    decisions,
    moving,
    plays,
    downloads,
    portal: input.portal ? { live, lastViewedAt: input.portal.last_viewed_at } : null,
    notifyCount: notify,
  };
}

const STAGE_ORDER = ['working_together', 'interested', 'released', 'engaged', 'contacted', 'new'];

/** Cards order: artists you are working with first, parked last, then by name. */
export function sortArtistSummaries(list: ArtistSummary[]): ArtistSummary[] {
  return [...list].sort((a, b) => {
    const pa = a.relationship.parked ? 1 : 0;
    const pb = b.relationship.parked ? 1 : 0;
    if (pa !== pb) return pa - pb;
    const sa = STAGE_ORDER.indexOf(a.relationship.stage);
    const sb = STAGE_ORDER.indexOf(b.relationship.stage);
    if (sa !== sb) return sa - sb;
    return a.contact.name.localeCompare(b.contact.name);
  });
}

/** "2 interested · 1 recording" — only the moving words, in pipeline order. */
export function describeMoving(decisions: Partial<Record<Decision, number>>): string {
  const order: Decision[] = ['interested', 'selected', 'recording', 'recorded', 'released'];
  return order.filter((d) => decisions[d]).map((d) => `${decisions[d]} ${d}`).join(' · ');
}
