/**
 * Engagement — the DERIVED axis of the artist ↔ beat relationship.
 *
 *   sent → opened → played → downloaded
 *
 * The furthest step reached, worked out from what actually happened. It is
 * never stored and never set by hand: a stored "opened" goes stale the moment
 * the artist plays the beat, and a hand-set one is a guess. The decision axis
 * (interested, selected, …) is the stored one; see `decisions.ts`.
 *
 * Sources, all already recorded by the app:
 *   - beat_sends: sent_at, opened_at (Resend open), link_clicked_at
 *   - the artist portal: a track in a portal project counts as SENT from the
 *     moment it was added there, and as OPENED once the artist opens the
 *     portal after that; portal plays and downloads are contact_activity rows.
 */

export const ENGAGEMENT_STEPS = ['sent', 'opened', 'played', 'downloaded'] as const;
export type EngagementStep = (typeof ENGAGEMENT_STEPS)[number];

export interface TrackSignal {
  trackId: string;
  step: EngagementStep;
  /** ISO timestamp. */
  at: string;
}

export interface TrackEngagement {
  step: EngagementStep | null;
  /** When the furthest step was first reached. */
  at: string | null;
  plays: number;
  downloads: number;
  lastPlayedAt: string | null;
}

const RANK: Record<EngagementStep, number> = { sent: 0, opened: 1, played: 2, downloaded: 3 };

export const EMPTY_ENGAGEMENT: TrackEngagement = { step: null, at: null, plays: 0, downloads: 0, lastPlayedAt: null };

/** Fold every signal into one engagement per track. */
export function engagementByTrack(signals: readonly TrackSignal[]): Map<string, TrackEngagement> {
  const out = new Map<string, TrackEngagement>();
  for (const s of signals) {
    if (!s.trackId || !Number.isFinite(Date.parse(s.at))) continue;
    const cur = out.get(s.trackId) ?? { ...EMPTY_ENGAGEMENT };
    if (s.step === 'played') {
      cur.plays += 1;
      if (!cur.lastPlayedAt || s.at > cur.lastPlayedAt) cur.lastPlayedAt = s.at;
    }
    if (s.step === 'downloaded') cur.downloads += 1;
    if (cur.step === null || RANK[s.step] > RANK[cur.step]) {
      cur.step = s.step;
      cur.at = s.at;
    } else if (RANK[s.step] === RANK[cur.step] && cur.at && s.at < cur.at) {
      cur.at = s.at;
    }
    out.set(s.trackId, cur);
  }
  return out;
}

export interface SendSignalRow {
  track_ids?: readonly string[] | null;
  sent_at?: string | null;
  opened_at?: string | null;
  link_clicked_at?: string | null;
}

/**
 * beat_sends → signals. An email open or a click on the link both mean the
 * artist has seen the send, so both read as OPENED.
 */
export function signalsFromSends(sends: readonly SendSignalRow[]): TrackSignal[] {
  const out: TrackSignal[] = [];
  for (const s of sends) {
    const opened = [s.opened_at, s.link_clicked_at].filter((v): v is string => !!v).sort()[0] ?? null;
    for (const trackId of s.track_ids ?? []) {
      if (s.sent_at) out.push({ trackId, step: 'sent', at: s.sent_at });
      if (opened) out.push({ trackId, step: 'opened', at: opened });
    }
  }
  return out;
}

export interface PortalTrackPlacement {
  trackId: string;
  /** project_tracks.added_at, or when the project was put in the portal if later. */
  availableAt: string;
}

/**
 * Portal placements → signals. A track is SENT when it becomes visible in the
 * portal, and OPENED at the first portal visit on or after that moment.
 */
export function signalsFromPortal(
  placements: readonly PortalTrackPlacement[],
  portalVisits: readonly string[],
): TrackSignal[] {
  const visits = [...portalVisits].filter((v) => Number.isFinite(Date.parse(v))).sort();
  const out: TrackSignal[] = [];
  for (const p of placements) {
    out.push({ trackId: p.trackId, step: 'sent', at: p.availableAt });
    const seen = visits.find((v) => v >= p.availableAt);
    if (seen) out.push({ trackId: p.trackId, step: 'opened', at: seen });
  }
  return out;
}

export interface ActivitySignalRow {
  kind: string;
  occurred_at: string;
  metadata?: Record<string, unknown> | null;
}

/** contact_activity `track_played` / `track_downloaded` rows → signals. */
export function signalsFromActivity(rows: readonly ActivitySignalRow[]): TrackSignal[] {
  const out: TrackSignal[] = [];
  for (const r of rows) {
    const trackId = typeof r.metadata?.track_id === 'string' ? r.metadata.track_id : null;
    if (!trackId) continue;
    if (r.kind === 'track_played') out.push({ trackId, step: 'played', at: r.occurred_at });
    if (r.kind === 'track_downloaded') out.push({ trackId, step: 'downloaded', at: r.occurred_at });
  }
  return out;
}

export const ENGAGEMENT_LABEL: Record<EngagementStep, string> = {
  sent: 'Sent',
  opened: 'Opened',
  played: 'Played',
  downloaded: 'Downloaded',
};
