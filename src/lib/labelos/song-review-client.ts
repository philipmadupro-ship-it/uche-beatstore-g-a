/**
 * The browser's side of the A&R inbox (LABEL-25): fetch the queue and save MY
 * review, saying what happened in words a toast can show. Pure of React.
 */
import type { ArInbox } from './ar-inbox-store';
import type { ReviewContent, ReviewPatch } from './song-review';

export type SaveResult = { ok: true; review: ReviewContent } | { ok: false; error: string };

export async function fetchInbox(orgId: string): Promise<ArInbox | null> {
  try {
    const res = await fetch(`/api/org/${orgId}/ar`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as ArInbox;
  } catch {
    return null;
  }
}

export async function putReview(orgId: string, songId: string, patch: ReviewPatch): Promise<SaveResult> {
  try {
    const res = await fetch(`/api/org/${orgId}/tracks/${songId}/reviews`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: string; review?: ReviewContent };
    if (!res.ok || !body.review) return { ok: false, error: body.error ?? 'Could not save the review.' };
    return { ok: true, review: body.review };
  } catch {
    return { ok: false, error: 'Could not save the review.' };
  }
}
