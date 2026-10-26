/**
 * `/shared` — "Shared with me" (LABEL-21, 07 §1): the projects other people
 * have admitted the viewer to, with the org that shared each and the
 * viewer's role. The viewer's OWN live memberships (`myExternalProjects`),
 * read on this request — a removed or expired one is simply not here.
 * One project opens straight away: there is nothing to choose.
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { myExternalProjects } from '@/lib/auth/org-access';
import { PROJECT_ROLE_LABELS } from '@/lib/labelos/project-members';

export const dynamic = 'force-dynamic';

export default async function SharedWithMePage() {
  const mine = await myExternalProjects();
  if (!mine.ok) notFound();
  if (mine.projects.length === 1) redirect(mine.projects[0].href);

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Shared with me</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Projects</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Projects other people shared with you. You see each one only, with the access they gave you.
        </p>
      </header>
      {mine.projects.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40" data-testid="shared-empty">
          Nothing is shared with you right now.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]" data-testid="shared-list">
          {mine.projects.map((p) => (
            <li key={p.id}>
              <Link href={p.href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-white/80">{p.name}</span>
                  <span className="block truncate text-[11px] text-white/40">Shared by {p.orgName}</span>
                </span>
                <span className="shrink-0 rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70">{PROJECT_ROLE_LABELS[p.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </PageContainer>
  );
}
