/**
 * The producer-facing shape of a project file. The storage reference (`url`)
 * is never sent to the browser — files are fetched through the download
 * route — so a row is always mapped through here, never returned raw.
 */

export interface ProjectAssetRow {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  file_name: string;
  url: string;
  mime: string | null;
  size_bytes: number | null;
  position: number;
  in_portal: boolean;
  portal_at: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface ProjectAssetView {
  id: string;
  project_id: string;
  kind: string;
  label: string;
  file_name: string;
  mime: string | null;
  size_bytes: number | null;
  position: number;
  in_portal: boolean;
  portal_at: string | null;
  created_at: string;
  downloadUrl: string;
}

export const PROJECT_ASSET_COLUMNS = 'id, project_id, kind, label, file_name, url, mime, size_bytes, position, in_portal, portal_at, created_at, updated_at';

export function toProjectAssetView(row: ProjectAssetRow): ProjectAssetView {
  return {
    id: row.id,
    project_id: row.project_id,
    kind: row.kind,
    label: row.label,
    file_name: row.file_name,
    mime: row.mime,
    size_bytes: row.size_bytes == null ? null : Number(row.size_bytes),
    position: row.position,
    in_portal: row.in_portal,
    portal_at: row.portal_at,
    created_at: row.created_at,
    downloadUrl: `/api/projects/${row.project_id}/assets/${row.id}/download`,
  };
}
