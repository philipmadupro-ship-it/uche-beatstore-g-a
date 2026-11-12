/**
 * Upload options — what to do with every file in the next upload, chosen BEFORE
 * the files go up.
 *
 * The upload flow only ever asked for the track type, and in the Library (where
 * the picker is launched from a button and the drop zone stays hidden) it did
 * not even ask that: the type was whatever was used last. Everything else —
 * state, tags, which project or playlist it belongs to — meant finding the track
 * again afterwards. These options are applied to each track as soon as the server
 * has created it.
 *
 * Applying is best-effort and reports what failed: the upload itself already
 * succeeded, so a failed tag must not look like a failed upload.
 *
 * Pure by design (CLAUDE.md: logic inside the component gets silently reverted);
 * `fetch` is injected so it is testable.
 */

import type { TrackStatus } from '@/lib/types';
import { addTracksToCollection, type CollectionKind } from '@/lib/library/collect-selection';

export interface UploadTag {
  tag: string;
  /** Taxonomy key (`genre`, `mood`, `instruments`, `status`) — what the tray's tagger writes. */
  category: string;
}

export interface UploadDestination {
  kind: CollectionKind;
  id: string;
  name: string;
}

export interface UploadPreset {
  status: TrackStatus | null;
  tags: UploadTag[];
  destination: UploadDestination | null;
}

export const EMPTY_PRESET: UploadPreset = { status: null, tags: [], destination: null };

export const UPLOAD_STATUS_OPTIONS: ReadonlyArray<{ value: TrackStatus; label: string }> = [
  { value: 'maq', label: 'MAQ' },
  { value: 'needs_work', label: 'WIP' },
  { value: 'finished', label: 'Finished' },
  { value: 'archived', label: 'Archived' },
];

/** How many things the preset will do — the badge on the Upload options button. */
export function presetCount(p: UploadPreset): number {
  return (p.status ? 1 : 0) + p.tags.length + (p.destination ? 1 : 0);
}

export function toggleUploadTag(tags: readonly UploadTag[], next: UploadTag): UploadTag[] {
  const key = next.tag.trim().toLowerCase();
  return tags.some((t) => t.tag.trim().toLowerCase() === key)
    ? tags.filter((t) => t.tag.trim().toLowerCase() !== key)
    : [...tags, next];
}

export interface ApplyReport {
  /** Human labels of what could not be applied; empty = everything worked. */
  failed: string[];
}

async function ok(res: Response): Promise<void> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/**
 * Apply the preset to one freshly created track. Each step is independent, so
 * one failing does not stop the others.
 *
 * `skipDestination` is for pages that already upload INTO a project or playlist
 * (their drop zone passes `playlistId`) — the page's own destination wins.
 */
export async function applyUploadPreset(
  trackId: string,
  preset: UploadPreset,
  opts: { skipDestination?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<ApplyReport> {
  const f = opts.fetchImpl ?? fetch;
  const id = encodeURIComponent(trackId);
  const failed: string[] = [];
  const json = { 'Content-Type': 'application/json' };

  const steps: Array<[string, () => Promise<void>]> = [];
  if (preset.status) {
    const status = preset.status;
    steps.push(['state', async () => ok(await f(`/api/tracks/${id}`, { method: 'PATCH', headers: json, body: JSON.stringify({ status }) }))]);
  }
  for (const t of preset.tags) {
    steps.push([`tag “${t.tag}”`, async () => ok(await f(`/api/tracks/${id}/tags`, { method: 'POST', headers: json, body: JSON.stringify({ tag: t.tag, category: t.category }) }))]);
  }
  if (preset.destination && !opts.skipDestination) {
    const d = preset.destination;
    steps.push([`${d.kind} “${d.name}”`, async () => { await addTracksToCollection({ kind: d.kind, existingId: d.id, name: '' }, [trackId], f); }]);
  }

  // Sequential on purpose: these are a handful of tiny writes per track, and a
  // 20-file upload already has its own concurrency to protect.
  for (const [label, run] of steps) {
    try { await run(); } catch { failed.push(label); }
  }
  return { failed };
}
