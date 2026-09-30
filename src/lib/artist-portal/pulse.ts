/**
 * Live portal updates without a realtime channel.
 *
 * The portal is anonymous — its visitor has no Supabase session, so RLS can
 * not scope a realtime subscription to one artist, and broadcasting table
 * changes to an anonymous socket would leak other artists' rows. Instead the
 * open portal polls `/api/portal/[token]/pulse` (only while its tab is
 * visible), which returns three fingerprints. The page compares them with the
 * ones from its last load:
 *   - comments / messages changed → refetch that thread quietly;
 *   - library changed (a beat, a file, a project, a decision) → offer
 *     "New from <producer> · Show", because reloading the library moves the
 *     NEW watermark and must stay the artist's choice.
 *
 * Pure: the route feeds rows, this hashes a canonical, order-independent
 * string of them. Only the fingerprints leave the server.
 */

import { createHash } from 'crypto';

export interface PulseInput {
  links: ReadonlyArray<{ project_id: string; allow_downloads: boolean; can_comment: boolean }>;
  projects: ReadonlyArray<{ id: string; name: string | null; cover_url: string | null }>;
  projectTracks: ReadonlyArray<{ project_id: string; track_id: string }>;
  files: ReadonlyArray<{ id: string; label: string; portal_at: string | null }>;
  states: ReadonlyArray<{ track_id: string; decision: string | null }>;
  comments: ReadonlyArray<{ id: string }>;
  messages: ReadonlyArray<{ id: string; request_status: string | null }>;
}

export interface PulseVersions {
  library: string;
  comments: string;
  messages: string;
}

function fingerprint(parts: string[]): string {
  return createHash('sha256').update([...parts].sort().join('\n')).digest('base64url').slice(0, 16);
}

export function pulseVersions(input: PulseInput): PulseVersions {
  return {
    library: fingerprint([
      ...input.links.map((l) => `l:${l.project_id}:${l.allow_downloads ? 1 : 0}${l.can_comment ? 1 : 0}`),
      ...input.projects.map((p) => `p:${p.id}:${p.name ?? ''}:${p.cover_url ?? ''}`),
      ...input.projectTracks.map((pt) => `t:${pt.project_id}:${pt.track_id}`),
      ...input.files.map((f) => `f:${f.id}:${f.label}:${f.portal_at ?? ''}`),
      ...input.states.map((s) => `s:${s.track_id}:${s.decision ?? ''}`),
    ]),
    comments: fingerprint(input.comments.map((c) => c.id)),
    messages: fingerprint(input.messages.map((m) => `${m.id}:${m.request_status ?? ''}`)),
  };
}

/** Which parts moved between two pulses. A missing previous pulse moves nothing. */
export function pulseChanges(prev: PulseVersions | null, next: PulseVersions): { library: boolean; comments: boolean; messages: boolean } {
  if (!prev) return { library: false, comments: false, messages: false };
  return {
    library: prev.library !== next.library,
    comments: prev.comments !== next.comments,
    messages: prev.messages !== next.messages,
  };
}
