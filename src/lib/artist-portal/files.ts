/**
 * Portal files: the project_assets rows with `in_portal` in a set of
 * projects, owner-filtered (service role). One loader so the portal page,
 * Notify, the Artists strip and the workspace agree on what the artist can
 * see. Before migration 127 there are simply no files — never an error that
 * takes the portal or the workspace down with it.
 */

import { selectIn } from '@/lib/db/chunked-in';
import { isMissingSchema } from '@/lib/artists/workspace-load';
import type { PortalFileRow } from './new-items';
import { loadAssetUploaders } from './uploads';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface PortalAssetRow {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  position: number;
  portal_at: string | null;
  created_at: string;
  /** Mig 191: the contact who uploaded it through their portal; null = the producer. */
  uploaded_by_contact_id?: string | null;
}

export async function loadPortalAssets(admin: Admin, userId: string, projectIds: readonly string[]): Promise<PortalAssetRow[]> {
  if (projectIds.length === 0) return [];
  let rows: PortalAssetRow[];
  try {
    rows = await selectIn<PortalAssetRow>((ids) => admin
      .from('project_assets')
      .select('id, project_id, kind, label, file_name, mime, size_bytes, position, portal_at, created_at')
      .in('project_id', ids)
      .eq('user_id', userId)
      .eq('in_portal', true)
      .order('position', { ascending: true }), [...projectIds]);
  } catch (err) {
    if (isMissingSchema(err)) return [];
    throw err;
  }
  const uploaders = await loadAssetUploaders(admin, userId, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, uploaded_by_contact_id: uploaders.get(r.id) ?? null }));
}

export function toPortalFileRows(rows: readonly PortalAssetRow[]): PortalFileRow[] {
  return rows.map((r) => ({ projectId: r.project_id, fileId: r.id, portalAt: r.portal_at ?? r.created_at, uploadedBy: r.uploaded_by_contact_id ?? null }));
}
