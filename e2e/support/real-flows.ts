/**
 * Real-database e2e helpers that do a product step THE WAY A PERSON DOES IT —
 * through the app's own routes on a signed-in session — so a spec that needs
 * the result as a precondition does not write the product field with the
 * service key (LABEL-77). A field written with the service key skips the
 * validator, the capability check and the audit event, so a bug in any of
 * them stays invisible to every spec that "just seeds" it.
 */
import { expect, type APIRequestContext } from '@playwright/test';

export type SplitLineInput = { party_id: string; role: string; share: number | string };

/**
 * Start a draft split sheet with these lines and circulate it, by the splits routes
 * (`POST …/tracks/<id>/splits`, then `…/<sheet>/circulate`). `api` must be a signed-in
 * session that holds `rights.write` (an owner is enough). Returns the sheet id.
 */
export async function circulateSplitSheet(
  api: APIRequestContext,
  orgId: string,
  trackId: string,
  kind: 'composition' | 'master',
  lines: SplitLineInput[],
): Promise<string> {
  const base = `/api/org/${orgId}/tracks/${trackId}/splits`;
  const made = await api.post(base, { data: { kind, lines: lines.map((l) => ({ ...l, share: String(l.share) })) } });
  expect(made.status(), `start ${kind} sheet: ${await made.text()}`).toBe(201);
  const { sheet } = (await made.json()) as { sheet: { id: string } };
  const out = await api.post(`${base}/${sheet.id}/circulate`);
  expect(out.ok(), `circulate ${kind} sheet: ${await out.text()}`).toBeTruthy();
  return sheet.id;
}
