'use client';

/**
 * `/o/<slug>/settings/digest` (LABEL-38): the member's own weekly digest
 * switch and, for owners and admins, the Slack channel. The routes enforce
 * who may do what; the panel only shows what the server says is allowed.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgDigestPanel } from '@/components/labelos/OrgDigestPanel';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export default function OrgDigestPage() {
  const shell = useOrgShell();
  if (!shell) return null;
  // The digest is a licensed module (LABEL-47): an org without it has no digest page.
  if (shell.modules && !shell.modules.includes('digest')) notFound();
  const { org } = shell;
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <Link
          href={`/o/${org.slug}/settings/members`}
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/40"
        >
          <ArrowLeft size={12} aria-hidden="true" />
          Members
        </Link>
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{ORG_KIND_LABELS[org.kind]} · Digest</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Weekly digest</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">A short weekly summary for people who do not open {org.name} every day.</p>
      </header>
      <OrgDigestPanel orgId={org.id} orgName={org.name} />
    </PageContainer>
  );
}
