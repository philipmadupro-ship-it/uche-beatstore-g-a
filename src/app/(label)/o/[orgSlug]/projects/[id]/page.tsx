/**
 * `/o/<slug>/projects/<id>` — an org project (LABEL-17, 07 §1): its artists,
 * the songs the member sees, and its files through `ProjectFilesSection`'s
 * org mode (LABEL-15 carry: built there, mounted here). Authorised with
 * requireObjectAccess on the project; anything out of scope is a real 404.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Music } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { ProjectFilesSection } from '@/components/projects/ProjectFilesSection';
import { RestrictedNote } from '@/components/artists/OrgArtistWorkspaceTabs';
import { orgShellFor, requireObjectAccess } from '@/lib/auth/org-access';
import { songStageLabel } from '@/lib/labelos/org-workspace';
import { loadOrgProject } from '@/lib/labelos/org-workspace-store';

export const dynamic = 'force-dynamic';

export default async function OrgProjectPage({ params }: { params: Promise<{ orgSlug: string; id: string }> }) {
  const { orgSlug, id } = await params;
  const shell = await orgShellFor(orgSlug);
  if (!shell) notFound();
  const access = await requireObjectAccess({ table: 'projects', id, cap: 'catalog.read', orgId: shell.org.id });
  if (!access.ok) notFound();
  const detail = await loadOrgProject(access);
  if (!detail) notFound();
  const base = `/o/${shell.org.slug}`;

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {detail.project.isInbox ? 'Inbox' : 'Project'} · {shell.org.name}
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">
          {detail.project.name}
        </h1>
        {detail.artists.length > 0 && (
          <p className="mt-2 text-[11px] text-white/60">
            {detail.artists.map((a, i) => (
              <span key={a.id}>
                {i > 0 && <span className="mx-2 text-white/30">·</span>}
                <Link href={`${base}/artists/${a.id}`} className="hover:text-white">{a.name}</Link>
              </span>
            ))}
          </p>
        )}
      </header>

      <section aria-labelledby="org-project-songs" className="mb-10 space-y-3">
        <h2 id="org-project-songs" className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">Songs</h2>
        {detail.songs.length === 0 && detail.restrictedSongs === 0 ? (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/40">No songs in this project yet.</p>
        ) : detail.songs.length > 0 ? (
          <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]">
            {detail.songs.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-3">
                <Music size={14} className="shrink-0 text-white/40" aria-hidden="true" />
                <Link href={`${base}/songs/${s.id}`} className="min-w-0 flex-1 truncate text-[13px] text-white/80 hover:text-white">{s.title ?? 'Untitled'}</Link>
                <span className="shrink-0 rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70">{songStageLabel(s.stage)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {detail.restrictedSongs > 0 && (
          <RestrictedNote>{`${detail.restrictedSongs} song${detail.restrictedSongs === 1 ? '' : 's'} still in development: restricted. Your role hears finished music only.`}</RestrictedNote>
        )}
      </section>

      <ProjectFilesSection projectId={detail.project.id} org={{ orgId: shell.org.id }} />
    </PageContainer>
  );
}
