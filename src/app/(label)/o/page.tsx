/**
 * `/o` — where a signed-in member lands when they have no particular org in
 * mind (the proxy sends a non-producer member here from `/login` and from the
 * dashboard paths, instead of the buyer account). One org opens straight away;
 * several are listed; with none, projects shared with them are the answer.
 * The list is the caller's own live memberships (`myOrganizations`).
 */
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PageContainer } from '@/components/layout/PageHeader';
import { myExternalProjects, myOrganizations } from '@/lib/auth/org-access';
import { isLabelOsEnabled } from '@/lib/labelos/flag';
import { ORG_KIND_LABELS, orgHome } from '@/lib/labelos/switcher';

export const dynamic = 'force-dynamic';

export default async function OrgIndexPage() {
  if (!isLabelOsEnabled()) notFound();
  const [mine, shared] = await Promise.all([myOrganizations(), myExternalProjects()]);
  if (!mine.ok) notFound();
  const orgs = mine.orgs.map((o) => ({ ...o, home: orgHome(o, mine.isProducer) }));
  if (orgs.length === 1 && !(shared.ok && shared.projects.length)) redirect(orgs[0].home);
  if (orgs.length === 0 && shared.ok && shared.projects.length) redirect('/shared');

  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">Your organizations</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Open a workspace</h1>
      </header>
      {orgs.length === 0 ? (
        <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/40" data-testid="org-index-empty">
          You are not a member of any organization yet. Open the invitation link you were sent to join one.
        </p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-xl border border-white/10 bg-[#0D0D0A]" data-testid="org-index-list">
          {orgs.map((o) => (
            <li key={o.id}>
              <Link href={o.home} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]">
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">{o.name}</span>
                <span className="shrink-0 rounded-lg border border-white/20 px-2 py-0.5 text-[11px] text-white/70">{ORG_KIND_LABELS[o.kind]}</span>
              </Link>
            </li>
          ))}
          {shared.ok && shared.projects.length > 0 ? (
            <li>
              <Link href="/shared" className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04]">
                <span className="min-w-0 flex-1 truncate text-[13px] text-white/80">Shared with me</span>
              </Link>
            </li>
          ) : null}
        </ul>
      )}
    </PageContainer>
  );
}
