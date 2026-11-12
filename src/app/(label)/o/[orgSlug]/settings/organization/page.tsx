'use client';

/**
 * `/o/<slug>/settings/organization` (LABEL-51): the owner's settings. Anyone
 * else who lands here is told so; the routes enforce it regardless.
 */
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageContainer } from '@/components/layout/PageHeader';
import { OrgSettingsPanel } from '@/components/labelos/OrgSettingsPanel';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export default function OrgSettingsPage() {
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
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">{ORG_KIND_LABELS[org.kind]} · Settings</p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Organization settings</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">How {org.name} runs: approvals, reminders and departments.</p>
      </header>
      {shell.role === 'owner' ? (
        <OrgSettingsPanel orgId={org.id} />
      ) : (
        <p className="text-[11px] text-white/70" data-testid="settings-denied">Only the owner of this organization can change its settings.</p>
      )}
    </PageContainer>
  );
}
