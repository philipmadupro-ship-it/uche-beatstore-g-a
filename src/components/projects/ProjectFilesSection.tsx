'use client';

/**
 * The project page's Files: references, artwork, lyric sheets and documents
 * that belong to the project rather than to one track.
 *
 *   FILES                                   ☑ Artists can see new files   [Add files]
 *   ▤ Split sheet     Document · 84 KB      ○ In portal   ↓   ⋯
 *
 * Drop files anywhere on the section or use Add files. Each row renames in
 * place, and its portal switch decides whether artists this project is shared
 * with can see it. New uploads default to visible only when the project is
 * already shared with an artist — otherwise a contract dropped here would go
 * straight into someone's portal. Renders nothing before migration 127.
 *
 * With `org` (LABEL-15) the same section is an ORGANIZATION project's files:
 * the /api/org routes, the org kinds (photo, video, contract, split sheet,
 * session), a Restricted marker instead of the portal switch (org files are
 * never in a portal), and only the controls the member's capabilities allow
 * (the GET says which). The server decides every permission; the UI only
 * hides what would be refused.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, Image as ImageIcon, Lock, Music, Paperclip, Upload } from 'lucide-react';
import { InlineText } from '@/components/ui/InlineText';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { toast, confirmToast } from '@/hooks/useToast';
import { ASSET_KIND_LABEL, PROJECT_ASSET_KINDS, formatBytes, type ProjectAssetKind } from '@/lib/projects/assets';
import { uploadOrgProjectAsset, uploadProjectAsset } from '@/lib/projects/upload-asset';
import type { ProjectAssetView } from '@/lib/projects/asset-view';
import { ALWAYS_RESTRICTED_KINDS, ORG_ASSET_KINDS, ORG_ASSET_KIND_LABEL, type AssetSensitivity, type OrgAssetKind } from '@/lib/labelos/org-assets';

type FileRow = ProjectAssetView & { sensitivity?: AssetSensitivity };
type Permissions = { write: boolean; restricted: boolean };

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

function KindIcon({ kind }: { kind: string }) {
  const Icon = kind === 'artwork' || kind === 'photo' ? ImageIcon : kind === 'audio' || kind === 'reference' ? Music : kind === 'other' ? Paperclip : FileText;
  return <Icon size={14} className="text-white/40" aria-hidden="true" />;
}

export function ProjectFilesSection({ projectId, org }: { projectId: string; org?: { orgId: string } }) {
  const orgId = org?.orgId ?? null;
  const base = orgId ? `/api/org/${orgId}/projects/${projectId}/assets` : `/api/projects/${projectId}/assets`;
  const [assets, setAssets] = useState<FileRow[] | null>(null);
  const [perms, setPerms] = useState<Permissions>({ write: true, restricted: false });
  const [ready, setReady] = useState(true);
  const [sharedWithArtists, setShared] = useState(false);
  const [visibleByDefault, setVisibleByDefault] = useState<boolean | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(base, orgId ? { cache: 'no-store' } : undefined);
      if (!res.ok) return;
      const data = await res.json() as { schemaReady: boolean; assets: FileRow[]; permissions?: Permissions };
      setReady(data.schemaReady !== false);
      setAssets(data.assets ?? []);
      if (data.permissions) setPerms(data.permissions);
    } catch {
      // Additive section: the page works without it.
    }
  }, [base, orgId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    // Org files are never in a portal; there is nothing to default from.
    if (orgId) return;
    fetch(`/api/projects/${projectId}/contacts`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      const shared = ((d?.contacts ?? []) as Array<{ link: { in_portal: boolean } }>).some((c) => c.link.in_portal);
      setShared(shared);
    }).catch(() => {});
  }, [projectId, orgId]);

  const inPortalForNew = visibleByDefault ?? sharedWithArtists;

  const upload = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading((n) => n + list.length);
    await Promise.all(list.map(async (file) => {
      try {
        const asset = orgId
          ? await uploadOrgProjectAsset(orgId, projectId, file)
          : await uploadProjectAsset(projectId, file, { inPortal: inPortalForNew });
        setAssets((prev) => [...(prev ?? []), asset]);
      } catch (err) {
        toast.error(`Could not upload ${file.name}`, err instanceof Error ? err.message : 'Try again');
      } finally {
        setUploading((n) => n - 1);
      }
    }));
  };

  const patch = async (
    asset: FileRow,
    body: Partial<Pick<ProjectAssetView, 'label' | 'in_portal'>> & { kind?: ProjectAssetKind | OrgAssetKind; sensitivity?: AssetSensitivity },
  ) => {
    const before = assets;
    setAssets((prev) => prev?.map((a) => (a.id === asset.id ? { ...a, ...body } : a)) ?? prev);
    try {
      const res = await fetch(`${base}/${asset.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Save failed');
      setAssets((prev) => prev?.map((a) => (a.id === asset.id ? data.asset : a)) ?? prev);
      return true;
    } catch (err) {
      setAssets(before);
      toast.error('Could not save', err instanceof Error ? err.message : 'Try again');
      return false;
    }
  };

  const remove = async (asset: FileRow) => {
    const ok = await confirmToast(`Delete ${asset.label}?`, asset.in_portal ? 'It also disappears from the artist portal.' : undefined, { confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    try {
      const res = await fetch(`${base}/${asset.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed');
      setAssets((prev) => prev?.filter((a) => a.id !== asset.id) ?? prev);
    } catch (err) {
      toast.error('Could not delete', err instanceof Error ? err.message : 'Try again');
    }
  };

  if (!ready || assets === null) return null;

  const canAdd = !orgId || perms.write;
  const canEdit = (a: FileRow) => !orgId || (perms.write && (a.sensitivity !== 'restricted' || perms.restricted));
  const kindLabel = (kind: string) => (orgId ? ORG_ASSET_KIND_LABEL[kind as OrgAssetKind] : ASSET_KIND_LABEL[kind as ProjectAssetKind]) ?? 'File';
  const kindChoices: readonly string[] = orgId ? ORG_ASSET_KINDS : PROJECT_ASSET_KINDS;

  return (
    <section
      aria-labelledby="project-files-heading"
      className={`mb-8 rounded-xl border p-4 transition-colors ${dragging ? 'border-white/30 bg-white/[0.06]' : 'border-white/10 bg-[#0D0D0A]'}`}
      data-testid="project-files"
      onDragOver={(e) => { if (canAdd && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(e) => {
        if (!canAdd || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        void upload(e.dataTransfer.files);
      }}
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 id="project-files-heading" className={LABEL}>Files</h2>
        <span className="text-[11px] text-white/30">{assets.length || ''}</span>
        {orgId ? <span className="ml-auto" /> : (
          <label className="ml-auto flex items-center gap-2 text-[11px] text-white/50">
            <input
              type="checkbox"
              checked={inPortalForNew}
              onChange={(e) => setVisibleByDefault(e.target.checked)}
              className="h-3.5 w-3.5 accent-white"
            />
            Artists can see new files
          </label>
        )}
        {canAdd && (
          <>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={uploading > 0}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
            >
              <Upload size={12} aria-hidden="true" />
              {uploading > 0 ? `Uploading ${uploading}…` : 'Add files'}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              className="hidden"
              aria-label="Add files to this project"
              data-testid="project-files-input"
              onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}
            />
          </>
        )}
      </div>

      {assets.length === 0 ? (
        <p className="py-4 text-center text-[11px] text-white/40">
          {orgId
            ? canAdd
              ? 'Artwork, photos, video, sessions, contracts, split sheets — drop them here. Contracts and split sheets are restricted to people who handle contracts.'
              : 'No files you can open yet.'
            : 'References, artwork, lyric sheets, split sheets — drop them here. Switch one into the portal and artists on this project can open it.'}
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {assets.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2" data-testid={`project-file-${a.id}`}>
              <KindIcon kind={a.kind} />
              <div className="min-w-0 flex-1">
                {canEdit(a) ? (
                  <InlineText
                    value={a.label}
                    label={`Rename ${a.label}`}
                    maxLength={200}
                    onSave={(next) => (next.trim() && next.trim() !== a.label ? patch(a, { label: next.trim() }) : true)}
                    className="block truncate text-[13px] text-white/80"
                  />
                ) : (
                  <span className="block truncate text-[13px] text-white/80">{a.label}</span>
                )}
                <p className="truncate text-[11px] text-white/40">
                  {[kindLabel(a.kind), formatBytes(a.size_bytes), a.file_name].filter(Boolean).join(' · ')}
                </p>
              </div>
              {orgId ? (
                a.sensitivity === 'restricted' && (
                  <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white/40" title="Only people who handle contracts can open this file">
                    <Lock size={12} aria-hidden="true" />
                    <span className="hidden sm:inline">Restricted</span>
                  </span>
                )
              ) : (
                <button
                  type="button"
                  role="switch"
                  aria-checked={a.in_portal}
                  aria-label={`${a.label} in the artist portal`}
                  onClick={() => void patch(a, { in_portal: !a.in_portal })}
                  className="flex shrink-0 items-center gap-2 text-[11px] text-white/60"
                >
                  <span className={`relative inline-flex h-4 w-7 items-center rounded-full border transition-colors ${a.in_portal ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-white/[0.06]'}`}>
                    <span className={`absolute h-2.5 w-2.5 rounded-full transition-transform ${a.in_portal ? 'translate-x-[14px] bg-[#6DC6A4]' : 'translate-x-[3px] bg-white/40'}`} />
                  </span>
                  <span className="hidden sm:inline">In portal</span>
                </button>
              )}
              <a
                href={a.downloadUrl}
                download
                aria-label={`Download ${a.label}`}
                className="shrink-0 rounded-lg p-2 text-white/50 transition-colors hover:bg-white/[0.10] hover:text-white"
              >
                <Download size={14} aria-hidden="true" />
              </a>
              <ActionMenu
                label={`${a.label} options`}
                sections={[
                  {
                    id: 'kind',
                    label: 'Kind',
                    items: kindChoices.map((k) => ({
                      id: `kind-${k}`,
                      label: kindLabel(k),
                      checked: a.kind === k,
                      hidden: !canEdit(a),
                      onSelect: () => { if (a.kind !== k) void patch(a, { kind: k as ProjectAssetKind | OrgAssetKind }); },
                    })),
                  },
                  {
                    id: 'sensitivity',
                    items: [{
                      id: 'restricted',
                      label: 'Restricted',
                      hint: 'Only people who handle contracts',
                      checked: a.sensitivity === 'restricted',
                      // Shown only where the member may lift or set it, and never for a kind that is always restricted.
                      hidden: !orgId || !perms.restricted || ALWAYS_RESTRICTED_KINDS.includes(a.kind as OrgAssetKind),
                      onSelect: () => { void patch(a, { sensitivity: a.sensitivity === 'restricted' ? 'normal' : 'restricted' }); },
                    }],
                  },
                  {
                    id: 'open',
                    items: [{ id: 'open', label: 'Open in a new tab', onSelect: () => { window.open(`${a.downloadUrl}?inline=1`, '_blank', 'noopener'); } }],
                  },
                  { id: 'danger', danger: true, items: [{ id: 'delete', label: 'Delete', danger: true, hidden: !canEdit(a), onSelect: () => remove(a) }] },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
