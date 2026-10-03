/**
 * Browser side of a project-file upload. Small files go through the app
 * (multipart POST); anything over the server's body limit is PUT straight to
 * the private bucket on a presigned URL and then registered. Either way the
 * caller gets the saved asset back, or an Error with the server's message.
 */

import { MAX_DIRECT_UPLOAD_BYTES, type ProjectAssetKind } from './assets';
import type { ProjectAssetView } from './asset-view';
import type { AssetSensitivity, OrgAssetKind, OrgAssetView } from '@/lib/labelos/org-assets';

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => ({})) as { error?: string };
  return new Error(body.error || fallback);
}

export async function uploadProjectAsset(
  projectId: string,
  file: File,
  opts: { inPortal: boolean; kind?: ProjectAssetKind; label?: string; fetchImpl?: typeof fetch } ,
): Promise<ProjectAssetView> {
  return uploadTo(`/api/projects/${projectId}/assets`, file, opts.fetchImpl ?? fetch, [
    ['in_portal', String(opts.inPortal)],
    ['kind', opts.kind],
    ['label', opts.label],
  ], { in_portal: opts.inPortal, kind: opts.kind, label: opts.label });
}

/**
 * The same upload into an ORGANIZATION project (LABEL-15): the org routes,
 * an org kind and a sensitivity instead of a portal switch (org files are
 * never in a portal).
 */
export async function uploadOrgProjectAsset(
  orgId: string,
  projectId: string,
  file: File,
  opts: { kind?: OrgAssetKind; label?: string; sensitivity?: AssetSensitivity; fetchImpl?: typeof fetch } = {},
): Promise<OrgAssetView> {
  return uploadTo(`/api/org/${orgId}/projects/${projectId}/assets`, file, opts.fetchImpl ?? fetch, [
    ['kind', opts.kind],
    ['label', opts.label],
    ['sensitivity', opts.sensitivity],
  ], { kind: opts.kind, label: opts.label, sensitivity: opts.sensitivity });
}

async function uploadTo<T>(
  base: string,
  file: File,
  f: typeof fetch,
  formFields: Array<[string, string | undefined]>,
  jsonFields: Record<string, unknown>,
): Promise<T> {
  if (file.size <= MAX_DIRECT_UPLOAD_BYTES) {
    const form = new FormData();
    form.append('file', file);
    for (const [k, v] of formFields) if (v) form.append(k, v);
    const res = await f(base, { method: 'POST', body: form });
    if (!res.ok) throw await errorOf(res, 'Upload failed');
    return ((await res.json()) as { asset: T }).asset;
  }

  const pre = await f(`${base}/presign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: file.name, size_bytes: file.size }),
  });
  if (!pre.ok) throw await errorOf(pre, 'Could not start the upload');
  const { uploadUrl, url, contentType } = await pre.json() as { uploadUrl: string; url: string; contentType: string };

  const put = await f(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: file });
  if (!put.ok) throw new Error('Upload to storage failed');

  const reg = await f(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, file_name: file.name, ...jsonFields }),
  });
  if (!reg.ok) throw await errorOf(reg, 'Upload failed');
  return ((await reg.json()) as { asset: T }).asset;
}
