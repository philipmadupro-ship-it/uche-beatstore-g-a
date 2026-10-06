'use client';

/**
 * The artist workspace in an ORGANIZATION (LABEL-17, 07 §2.2, 17 R12) —
 * /o/<slug>/artists/<contactId>.
 *
 *   Overview │ Projects │ Songs │ Releases │ Files │ Activity
 *
 * The producer's ArtistWorkspaceTabs in org context: the same tab strip and
 * URL state (`WorkspaceTabBar`, `useUrlTab`), the same card and row anatomy,
 * and `ProjectFilesSection` in its org mode for files. Its data is one
 * `/api/org/[orgId]/artists/[contactId]/workspace` payload, never a producer
 * route. What the member's capabilities exclude is already absent from that
 * payload; where something was left out, the section says "restricted"
 * instead of looking empty (07 §3.4).
 */

import Link from 'next/link';
import { Layers, Lock, Music } from 'lucide-react';
import { ArtworkFallback } from '@/components/ui/ArtworkFallback';
import { ProjectFilesSection } from '@/components/projects/ProjectFilesSection';
import { ArtistActivityTab } from '@/components/labelos/ArtistActivityTab';
import { OrgUploadPanel } from '@/components/labelos/OrgUploadPanel';
import { SongStageControl } from '@/components/labelos/SongStageControl';
import {
  ORG_WORKSPACE_TABS,
  ORG_WORKSPACE_TAB_LABEL,
  readOrgWorkspaceTab,
  stageCounts,
  type OrgWorkspaceTab,
} from '@/lib/labelos/org-workspace';
import type { OrgArtistWorkspace, OrgWorkspaceProject, OrgWorkspaceRelease } from '@/lib/labelos/org-workspace-store';
import { WorkspaceTabBar, useUrlTab } from './ArtistWorkspaceTabs';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const EMPTY = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40';

function readTab(): OrgWorkspaceTab {
  if (typeof window === 'undefined') return 'overview';
  return readOrgWorkspaceTab(new URLSearchParams(window.location.search).get('tab'));
}

/** "N songs: restricted" — the visible trace of what the member may not see (07 §3.4). */
export function RestrictedNote({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-[11px] text-white/50" data-testid={testId}>
      <Lock size={12} className="shrink-0 text-white/30" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

export function OrgArtistWorkspaceTabs({ orgId, orgSlug, workspace, viewerId }: {
  orgId: string;
  orgSlug: string;
  workspace: OrgArtistWorkspace;
  /** The signed-in member: their own activity lines read "You". */
  viewerId?: string;
}) {
  const [tab, go] = useUrlTab<OrgWorkspaceTab>(readTab, 'overview');
  const name = workspace.contact.name;
  const base = `/o/${orgSlug}`;

  return (
    <div className="min-w-0" data-testid="org-artist-workspace">
      <WorkspaceTabBar
        tabs={ORG_WORKSPACE_TABS}
        labelOf={(t) => ORG_WORKSPACE_TAB_LABEL[t]}
        current={tab}
        onSelect={go}
        ariaLabel={`${name} workspace`}
        badge={(t) => (
          <>
            {t === 'projects' && workspace.projects.length > 0 && <span className="ml-1.5 text-white/30">{workspace.projects.length}</span>}
            {t === 'songs' && workspace.songs.length > 0 && <span className="ml-1.5 text-white/30">{workspace.songs.length}</span>}
            {t === 'releases' && workspace.releases.length > 0 && <span className="ml-1.5 text-white/30">{workspace.releases.length}</span>}
          </>
        )}
      />

      <div role="tabpanel" id={`ws-panel-${tab}`} aria-labelledby={`ws-tab-${tab}`}>
        {tab === 'overview' && <OverviewTab workspace={workspace} base={base} onOpen={go} />}
        {tab === 'projects' && <ProjectsTab workspace={workspace} base={base} />}
        {tab === 'songs' && <SongsTab orgId={orgId} workspace={workspace} base={base} />}
        {tab === 'releases' && <ReleasesTab workspace={workspace} base={base} />}
        {tab === 'files' && <FilesTab orgId={orgId} workspace={workspace} base={base} />}
        {tab === 'activity' && <ArtistActivityTab orgId={orgId} orgSlug={orgSlug} contactId={workspace.contact.id} viewerId={viewerId} />}
      </div>
    </div>
  );
}

/* ── Overview ─────────────────────────────────────────────────────────── */

function OverviewTab({ workspace, base, onOpen }: { workspace: OrgArtistWorkspace; base: string; onOpen: (t: OrgWorkspaceTab) => void }) {
  const counts = stageCounts(workspace.songs);
  const next = workspace.releases.find((r) => r.state === 'draft') ?? null;
  const active = workspace.projects.filter((p) => p.status !== 'archived');
  return (
    <div className="space-y-8">
      <section aria-labelledby="ows-stages">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="ows-stages" className={LABEL}>Songs by stage</h2>
          <button type="button" onClick={() => onOpen('songs')} className="text-[11px] text-white/50 hover:text-white">All songs</button>
        </div>
        {counts.length === 0 ? (
          <p className="text-[11px] text-white/40">No songs yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2" data-testid="ows-stage-counts">
            {counts.map((c) => (
              <li key={c.stage} className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-white/70">
                {c.label} <span className="ml-1 font-mono text-white/40">{c.count}</span>
              </li>
            ))}
          </ul>
        )}
        {workspace.restrictedSongs > 0 && (
          <div className="mt-3">
            <RestrictedNote>{restrictedSongsText(workspace.restrictedSongs)}</RestrictedNote>
          </div>
        )}
      </section>

      <section aria-labelledby="ows-next">
        <h2 id="ows-next" className={`${LABEL} mb-3`}>Next release</h2>
        {!workspace.releasesReady ? (
          <p className="text-[11px] text-white/40">Releases need migration 144 applied on Supabase.</p>
        ) : next ? (
          <button type="button" onClick={() => onOpen('releases')} className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-3 text-left transition-colors hover:border-white/20">
            <span className="min-w-0 truncate text-[13px] text-white/80">{next.title}</span>
            <span className="shrink-0 text-[11px] text-white/40">{releaseMeta(next)}</span>
          </button>
        ) : (
          <p className="text-[11px] text-white/40">No release in progress.</p>
        )}
      </section>

      <section aria-labelledby="ows-active">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="ows-active" className={LABEL}>Active projects</h2>
          <button type="button" onClick={() => onOpen('projects')} className="text-[11px] text-white/50 hover:text-white">All projects</button>
        </div>
        {active.length === 0 ? (
          <p className="text-[11px] text-white/40">No active projects.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {active.slice(0, 4).map((p) => <ProjectCardMini key={p.id} project={p} href={`${base}/projects/${p.id}`} />)}
          </div>
        )}
      </section>
    </div>
  );
}

function restrictedSongsText(n: number): string {
  return `${n} song${n === 1 ? '' : 's'} still in development: restricted. Your role hears finished music only.`;
}

function ProjectCardMini({ project, href }: { project: OrgWorkspaceProject; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3 transition-colors hover:border-white/20">
      <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
        <ArtworkFallback src={project.cover_url} seed={project.id} kind="project" sizes="48px" className="object-cover">
          <Layers size={16} className="text-white/30" aria-hidden="true" />
        </ArtworkFallback>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-white/80">{project.name}</span>
        <span className="block text-[11px] text-white/40">
          {project.songs} song{project.songs === 1 ? '' : 's'}{project.isInbox ? ' · inbox' : ''}
        </span>
      </span>
    </Link>
  );
}

/* ── Projects ─────────────────────────────────────────────────────────── */

function ProjectsTab({ workspace, base }: { workspace: OrgArtistWorkspace; base: string }) {
  if (workspace.projects.length === 0) {
    return <p className={EMPTY}>No projects yet. The first demo uploaded for {workspace.contact.name} creates their Inbox.</p>;
  }
  return (
    <ul className="space-y-3">
      {workspace.projects.map((p) => (
        <li key={p.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid={`ows-project-${p.id}`}>
          <div className="flex items-start gap-3">
            <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
              <ArtworkFallback src={p.cover_url} seed={p.id} kind="project" sizes="56px" className="object-cover">
                <Layers size={18} className="text-white/30" aria-hidden="true" />
              </ArtworkFallback>
            </span>
            <div className="min-w-0 flex-1">
              <Link href={`${base}/projects/${p.id}`} className="text-[14px] text-white/90 hover:text-white">{p.name}</Link>
              <p className="mt-0.5 text-[11px] text-white/40">
                {p.songs} song{p.songs === 1 ? '' : 's'}
                {p.isInbox ? ' · inbox' : ''}
                {p.status === 'archived' ? ' · archived' : ''}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Songs ────────────────────────────────────────────────────────────── */

function SongsTab({ orgId, workspace, base }: { orgId: string; workspace: OrgArtistWorkspace; base: string }) {
  const { songs, restrictedSongs } = workspace;
  return (
    <div className="space-y-3">
      {workspace.permissions.write && <OrgUploadPanel orgId={orgId} artists={[{ id: workspace.contact.id, name: workspace.contact.name }]} />}
      {songs.length === 0 && restrictedSongs === 0 ? (
        <p className={EMPTY}>No songs yet. Upload a demo for {workspace.contact.name} and it lands in their Inbox.</p>
      ) : songs.length > 0 ? (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
          {songs.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-3" data-testid={`ows-song-${s.id}`}>
              <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.06]">
                <ArtworkFallback src={s.cover_url} seed={s.id} kind="track" sizes="40px" className="object-cover">
                  <Music size={14} className="text-white/30" aria-hidden="true" />
                </ArtworkFallback>
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`${base}/songs/${s.id}`} className="block truncate text-[13px] text-white/80 hover:text-white">{s.title ?? 'Untitled'}</Link>
                <p className="truncate text-[11px] text-white/40">{s.projects.map((p) => p.name).join(' · ')}</p>
              </div>
              <SongStageControl orgId={orgId} songId={s.id} stage={s.stage} testId={`ows-song-stage-${s.id}`} />
            </li>
          ))}
        </ul>
      ) : null}
      {restrictedSongs > 0 && <RestrictedNote testId="ows-songs-restricted">{restrictedSongsText(restrictedSongs)}</RestrictedNote>}
    </div>
  );
}

/* ── Releases ─────────────────────────────────────────────────────────── */

const RELEASE_TYPE_LABEL: Record<string, string> = { single: 'Single', ep: 'EP', album: 'Album', mixtape: 'Mixtape', compilation: 'Compilation' };

function releaseMeta(r: OrgWorkspaceRelease): string {
  const date = r.releaseDate ?? r.targetDate;
  return [RELEASE_TYPE_LABEL[r.type] ?? r.type, r.state, date ? new Date(`${date}T00:00:00`).toLocaleDateString() : null].filter(Boolean).join(' · ');
}

function ReleasesTab({ workspace, base }: { workspace: OrgArtistWorkspace; base: string }) {
  if (!workspace.releasesReady) return <p className={EMPTY}>Releases need migration 144 applied on Supabase.</p>;
  if (workspace.releases.length === 0) return <p className={EMPTY}>No releases for {workspace.contact.name} yet.</p>;
  return (
    <ul className="space-y-3">
      {workspace.releases.map((r) => (
        <li key={r.id} className="rounded-xl border border-white/10 bg-[#0D0D0A] p-4" data-testid={`ows-release-${r.id}`}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[14px] text-white/90">{r.title}</p>
            <p className="shrink-0 text-[11px] text-white/40">{releaseMeta(r)}</p>
          </div>
          {r.items.length === 0 ? (
            <p className="mt-2 text-[11px] text-white/40">No tracks yet.</p>
          ) : (
            <ol className="mt-3 divide-y divide-white/[0.06] border-t border-white/[0.06]">
              {r.items.map((i) => (
                <li key={`${i.position}-${i.songTrackId}`} className="flex items-center gap-3 py-2">
                  <span className="w-5 shrink-0 text-right font-mono text-[10px] text-white/30">{i.position}</span>
                  {i.restricted ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-white/40"><Lock size={10} aria-hidden="true" /> Restricted song</span>
                  ) : (
                    <Link href={`${base}/songs/${i.songTrackId}`} className="min-w-0 truncate text-[13px] text-white/80 hover:text-white">{i.title}</Link>
                  )}
                </li>
              ))}
            </ol>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ── Files ────────────────────────────────────────────────────────────── */

function FilesTab({ orgId, workspace, base }: { orgId: string; workspace: OrgArtistWorkspace; base: string }) {
  if (workspace.projects.length === 0) return <p className={EMPTY}>No projects yet, so no files.</p>;
  return (
    <div className="space-y-8">
      {workspace.projects.map((p) => (
        <section key={p.id} aria-label={`${p.name} files`}>
          <Link href={`${base}/projects/${p.id}`} className="mb-1.5 inline-block text-[11px] text-white/50 hover:text-white">{p.name}</Link>
          <ProjectFilesSection projectId={p.id} org={{ orgId }} />
        </section>
      ))}
    </div>
  );
}
