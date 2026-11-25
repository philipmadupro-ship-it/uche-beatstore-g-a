import { assetContentKey } from './content-key';
import type { Asset, AssetKind } from './types';
import type { ProjectAssetView } from '@/lib/projects/asset-view';

/**
 * A project file as an Asset. The input is `ProjectAssetView` — the shape the
 * routes already send the browser, which has no `url` — so a stored reference
 * cannot get in here. The fingerprint is therefore built from what a re-upload
 * changes in the view (size, created/updated time, file name).
 */
function kindOf(view: Pick<ProjectAssetView, 'kind' | 'mime'>): AssetKind {
  if (view.mime?.startsWith('audio/') || view.kind === 'audio') return 'audio';
  if (view.kind === 'artwork' || view.mime?.startsWith('image/')) return 'artwork';
  if (view.kind === 'document' || view.kind === 'lyrics') return 'document';
  return 'other';
}

export function assetsOfProject(views: readonly ProjectAssetView[]): Asset[] {
  return views.map((v): Asset => {
    const kind = kindOf(v);
    return {
      id: `project:${v.project_id}:file:${v.id}`,
      source: 'project_file',
      kind,
      ownerType: 'project',
      ownerId: v.project_id,
      label: v.label,
      fileName: v.file_name,
      mime: v.mime,
      sizeBytes: v.size_bytes,
      // Project files are always the private bucket (or its local fallback), never public.
      location: 'private',
      contentKey: assetContentKey(`${v.file_name}|${v.size_bytes ?? ''}|${v.created_at}`),
      playable: kind === 'audio',
      openUrl: v.downloadUrl,
      offline: 'none',
    };
  });
}
