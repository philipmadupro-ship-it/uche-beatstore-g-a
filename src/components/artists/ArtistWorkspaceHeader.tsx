'use client';

/**
 * The artist workspace's portal controls, in the contact's identity card:
 * relationship stage, "Portal live · opened 2d ago", Notify · N new, Copy
 * portal link, and a ⋯ menu for revoke / reissue. The link never changes
 * unless the producer reissues it.
 */

import { useState } from 'react';
import { BellRing, Copy, DoorOpen } from 'lucide-react';
import { ActionMenu } from '@/components/ui/ActionMenu';
import { copyToClipboard } from '@/lib/clipboard';
import { toast, confirmToast } from '@/hooks/useToast';
import { RELATIONSHIP_META } from '@/lib/contacts/relationship';
import { relativeDays } from '@/components/crm/contacts-shared';
import { jsonOrThrow, type ReadyWorkspace } from './types';

export function ArtistWorkspaceHeader({
  contactId,
  contactName,
  workspace,
  onChanged,
}: {
  contactId: string;
  contactName: string;
  workspace: ReadyWorkspace;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const { portal, relationship, notify } = workspace;

  const portalAction = async (action: 'create' | 'revoke' | 'reissue') => {
    setBusy(true);
    try {
      const data = await jsonOrThrow<{ portal: { url: string } }>(await fetch(`/api/contacts/${contactId}/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      }));
      if (action === 'revoke') toast.success('Portal revoked', 'The link no longer opens.');
      else {
        const copied = await copyToClipboard(data.portal.url);
        toast.success(action === 'reissue' ? 'New portal link' : 'Portal created', copied ? 'Link copied.' : data.portal.url);
      }
      onChanged();
    } catch (err) {
      toast.error('Portal', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  };

  const notifyArtist = async () => {
    setBusy(true);
    try {
      const data = await jsonOrThrow<{ itemCount: number; recipient: string }>(await fetch(`/api/contacts/${contactId}/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }));
      toast.success(`Notified ${contactName}`, `${data.itemCount} new · sent to ${data.recipient}`);
      onChanged();
    } catch (err) {
      toast.error('Notify failed', err instanceof Error ? err.message : 'Try again');
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    if (!portal) return;
    const ok = await copyToClipboard(portal.url);
    if (ok) toast.success('Portal link copied');
    else toast.error('Copy failed', portal.url);
  };

  const live = portal && !portal.revoked_at;

  return (
    <div className="mt-4 space-y-3" data-testid="artist-workspace-header">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-lg border border-white/20 px-2 py-1 text-[11px] text-white/80" data-testid="relationship-stage">
          {RELATIONSHIP_META[relationship.stage].label}
        </span>
        {relationship.parked && (
          <span className="rounded-lg border border-white/10 px-2 py-1 text-[11px] text-white/40">Parked · {relationship.parked}</span>
        )}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-white/60">
        <DoorOpen size={12} aria-hidden="true" className={live ? 'text-[#6DC6A4]' : 'text-white/30'} />
        {!portal && 'No portal yet'}
        {portal?.revoked_at && 'Portal revoked'}
        {live && (portal.last_viewed_at ? `Portal live · opened ${relativeDays(portal.last_viewed_at)}` : 'Portal live · not opened yet')}
      </p>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={notifyArtist}
          disabled={busy || !live || notify.total === 0}
          title={notify.total === 0 ? 'Nothing new since the last notify' : `Email ${contactName} about ${notify.total} new`}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
        >
          <BellRing size={12} aria-hidden="true" />
          Notify{notify.total > 0 ? ` · ${notify.total} new` : ''}
        </button>
        {live ? (
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
          >
            <Copy size={12} aria-hidden="true" />
            Copy link
          </button>
        ) : (
          <button
            type="button"
            onClick={() => portalAction(portal ? 'reissue' : 'create')}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
          >
            <DoorOpen size={12} aria-hidden="true" />
            {portal ? 'Reissue portal' : 'Create portal'}
          </button>
        )}
        <ActionMenu
          label="Portal actions"
          busy={busy}
          sections={[
            {
              id: 'portal',
              items: [
                { id: 'open', label: 'Open portal', hidden: !live, onSelect: () => { window.open(portal!.url, '_blank', 'noopener'); } },
                {
                  id: 'reissue',
                  label: 'Reissue link',
                  hint: 'Old link stops working',
                  hidden: !portal,
                  onSelect: async () => {
                    const ok = await confirmToast('Reissue the portal link?', `The current link stops working. ${contactName} needs the new one.`, { confirmLabel: 'Reissue', cancelLabel: 'Keep' });
                    if (ok) await portalAction('reissue');
                  },
                },
              ],
            },
            {
              id: 'danger',
              danger: true,
              items: [
                {
                  id: 'revoke',
                  label: 'Revoke portal',
                  danger: true,
                  hidden: !live,
                  onSelect: async () => {
                    const ok = await confirmToast('Revoke the portal?', 'The link stops working until you reissue it.', { confirmLabel: 'Revoke', cancelLabel: 'Keep', danger: true });
                    if (ok) await portalAction('revoke');
                  },
                },
              ],
            },
          ]}
        />
      </div>
    </div>
  );
}
