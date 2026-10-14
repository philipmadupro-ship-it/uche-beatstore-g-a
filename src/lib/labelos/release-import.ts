/**
 * "Already released" import (LABEL-42, 14 §1). A label or producer enters an
 * album that is already out — on Spotify, say — as a release that skips every
 * gate: there is nothing left to ready. Skipping the gates is the owner's word
 * and nothing checks it, so it is OWNER or ADMIN only (a role, not a
 * capability: `release.write` is held by A&R), needs a release date that has
 * come, and is an audited event (`release.imported`).
 */
export const IMPORT_ROLES = ['owner', 'admin'] as const;

export type ImportPlan = { ok: true } | { ok: false; status: 400 | 403; error: string; field?: string };

export function planImport(input: { role: string; releaseDate: string | null }, now: Date): ImportPlan {
  if (!(IMPORT_ROLES as readonly string[]).includes(input.role)) {
    return { ok: false, status: 403, error: 'Only an owner or an admin can enter a release as already out' };
  }
  if (!input.releaseDate) return { ok: false, status: 400, error: 'Give the date it came out', field: 'release_date' };
  if (input.releaseDate > now.toISOString().slice(0, 10)) {
    return { ok: false, status: 400, error: 'A release that is already out has a release date that has come', field: 'release_date' };
  }
  return { ok: true };
}

/** `delivered_at` of an import: noon UTC of the day it came out (the same convention as a delivery's `delivered_on`). */
export function importedDeliveredAt(releaseDate: string): string {
  return `${releaseDate}T12:00:00.000Z`;
}
