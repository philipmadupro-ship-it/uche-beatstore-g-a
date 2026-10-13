'use client';

/**
 * `/o/<slug>/settings/data` (LABEL-39): export the organization's data and
 * delete it. Owners only — anyone else who lands here is told so; the routes
 * enforce it regardless of what this page shows.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgDataPanel } from '@/components/labelos/OrgDataPanel';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export default function OrgDataPage() {
  const shell = useOrgShell();
  if (!shell) return null;
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
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{ORG_KIND_LABELS[org.kind]} · Data</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Export &amp; deletion</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">Take a copy of {org.name}, or close it down.</p>
      </header>
      <OrgDataPanel org={org} isOwner={shell.role === 'owner'} />
    </PageContainer>
  );
}
