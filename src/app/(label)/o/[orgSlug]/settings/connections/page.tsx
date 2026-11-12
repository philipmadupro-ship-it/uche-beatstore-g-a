'use client';

/**
 * `/o/<slug>/settings/connections` (LABEL-41, D1): who this label or artist
 * org is connected to and — for an artist org — what each label can reach.
 * Owners and admins who see the whole org manage it; everyone else is told
 * where the page ends (the routes refuse them anyway).
 */
import { PageContainer } from '@/components/layout/PageHeader';
import { ConnectionsPanel } from '@/components/labelos/ConnectionsPanel';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { ORG_KIND_LABELS } from '@/lib/labelos/switcher';

export default function OrgConnectionsPage() {
  const shell = useOrgShell();
  if (!shell) return null;
  const { org } = shell;
  const manage = shell.can('org.manage') && shell.scope === 'org' && shell.role !== 'artist';
  return (
    <PageContainer>
      <header className="mb-6 sm:mb-8">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
          {ORG_KIND_LABELS[org.kind]} · Connections
        </p>
        <h1 className="font-heading text-[28px] font-bold leading-[1.05] tracking-tight text-white sm:text-[32px] md:text-[40px]">Connections</h1>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/70">
          {org.kind === 'artist'
            ? 'Labels you are connected to, and what each can hear.'
            : 'Artist organizations connected to this label, and the music they share with it.'}
        </p>
      </header>
      {org.kind !== 'label' && org.kind !== 'artist' ? (
        <p className="text-[11px] text-white/60">Only label and artist organizations connect.</p>
      ) : !manage ? (
        <p className="text-[11px] text-white/60">Only the owners and admins who see the whole organization manage connections.</p>
      ) : (
        <ConnectionsPanel orgId={org.id} orgSlug={org.slug} orgKind={org.kind} />
      )}
    </PageContainer>
  );
}
