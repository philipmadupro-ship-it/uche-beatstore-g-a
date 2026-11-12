/**
 * `/shared` — "Shared with me" (LABEL-21, 07 §1): the projects other people
 * have admitted the viewer to, with the org that shared each and the
 * viewer's role. The viewer's OWN live memberships (`myExternalProjects`),
 * read on this request — a removed or expired one is simply not here.
 * One project opens straight away: there is nothing to choose.
 */
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { MySessionsView } from '@/components/labelos/MySessionsView';
import { myExternalProjects } from '@/lib/auth/org-access';
import { loadMySessions } from '@/lib/labelos/my-sessions-store';

export const dynamic = 'force-dynamic';

export default async function SharedWithMePage() {
  const mine = await myExternalProjects();
  if (!mine.ok) notFound();
  // One project with nothing waiting opens straight away: there is nothing to choose.
  const sessions = await loadMySessions(mine.userId, mine.projects);
  if (mine.projects.length === 1 && sessions.every((o) => o.askCount === 0)) redirect(mine.projects[0].href);

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Shared with me</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">My sessions</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          Your sessions, grouped by who shared them. You see each project only, with the access they gave you, and anything waiting on you.
        </p>
      </header>
      <MySessionsView sessions={sessions} />
    </PageContainer>
  );
}
