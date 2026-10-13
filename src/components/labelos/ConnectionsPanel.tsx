'use client';

/**
 * Artist ↔ label connections (LABEL-41, D1) as one org sees them, at
 * `/o/<slug>/settings/connections`:
 *
 *  - ask the other side to connect, by slug or email (a label asks an artist
 *    org, an artist org asks a label);
 *  - accept a request the other side made;
 *  - an ARTIST org sees each label it is connected to and decides what that
 *    label can reach: the whole catalogue or selected projects, and whether
 *    the label may copy a recording (D6). A label sees "Open shared music";
 *    it has no say in what is shared;
 *  - end a connection, or withdraw / decline a request.
 *
 * The routes re-check every change (`org.manage`, the artist side only for
 * sharing); this only offers what they will accept.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Dropdown } from '@/components/ui/Dropdown';
import { ListContainer } from '@/components/ui/ListRow';
import { Popover } from '@/components/ui/Popover';
import { confirmToast, toast } from '@/hooks/useToast';
import { shareSummary, statusLabel, type ConnectionView, type ShareMode } from '@/lib/labelos/connections';
import { cn } from '@/lib/utils';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';

type Choice = { id: string; name: string };
type Load = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; connections: ConnectionView[]; projects: Choice[] };

async function readJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

export function ConnectionsPanel({ orgId, orgSlug, orgKind }: { orgId: string; orgSlug: string; orgKind: 'label' | 'artist' }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [target, setTarget] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const other = orgKind === 'label' ? 'artist' : 'label';

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/org/${orgId}/connections`, { cache: 'no-store' });
      const body = await readJson(res);
      if (!res.ok) {
        setLoad({ state: 'failed', message: typeof body.error === 'string' ? body.error : 'Could not load connections.' });
        return;
      }
      if (typeof body.notReady === 'string') {
        setLoad({ state: 'failed', message: body.notReady });
        return;
      }
      setLoad({ state: 'ready', connections: (body.connections as ConnectionView[]) ?? [], projects: (body.projects as Choice[]) ?? [] });
    } catch {
      setLoad({ state: 'failed', message: 'Could not reach the server. Reload to try again.' });
    }
  }, [orgId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const send = async () => {
    const value = target.trim();
    if (!value) return;
    setSending(true);
    try {
      const res = await fetch(`/api/org/${orgId}/connections`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value.includes('@') ? { email: value } : { slug: value }),
      });
      const body = await readJson(res);
      if (res.status === 202) {
        // The answer is the same whether or not that organization exists.
        toast.success('Request sent', `If a ${other} organization matches, it will see your request.`);
        setTarget('');
        await refresh();
      } else {
        toast.error('Could not send the request', typeof body.error === 'string' ? body.error : undefined);
      }
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setSending(false);
    }
  };

  const act = async (c: ConnectionView, run: () => Promise<Response>, ok: string) => {
    setBusy(c.id);
    try {
      const res = await run();
      const body = await readJson(res);
      if (!res.ok) {
        toast.error('Could not do that', typeof body.error === 'string' ? body.error : undefined);
        return;
      }
      toast.success(ok);
      await refresh();
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  const accept = (c: ConnectionView) =>
    act(c, () => fetch(`/api/org/${orgId}/connections/${c.id}/accept`, { method: 'POST' }), `Connected with ${c.other.name}`);

  const end = async (c: ConnectionView) => {
    const pending = c.status === 'requested';
    const title = pending ? (c.initiatedByMe ? `Withdraw the request to ${c.other.name}?` : `Decline ${c.other.name}?`) : `End the connection with ${c.other.name}?`;
    const detail = pending
      ? 'You can ask again later.'
      : orgKind === 'artist'
        ? `${c.other.name} loses access to everything you shared, on its next request. Anything it already copied stays with it.`
        : `You lose access to ${c.other.name}’s shared music straight away. Anything you copied stays yours.`;
    const confirmed = await confirmToast(title, detail, { confirmLabel: pending ? (c.initiatedByMe ? 'Withdraw' : 'Decline') : 'End connection', danger: true });
    if (!confirmed) return;
    await act(c, () => fetch(`/api/org/${orgId}/connections/${c.id}`, { method: 'DELETE' }), pending ? 'Done' : 'Connection ended');
  };

  const patchShare = async (c: ConnectionView, body: { share_mode?: ShareMode; project_ids?: string[]; allow_copies?: boolean }) => {
    setBusy(c.id);
    try {
      const res = await fetch(`/api/org/${orgId}/connections/${c.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await readJson(res);
      if (!res.ok) {
        toast.error('Could not change what is shared', typeof json.error === 'string' ? json.error : undefined);
        return;
      }
      const next = json.connection as ConnectionView | null;
      if (next) setLoad((cur) => (cur.state === 'ready' ? { ...cur, connections: cur.connections.map((x) => (x.id === next.id ? next : x)) } : cur));
    } catch {
      toast.error('Could not reach the server');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="connect-heading">
        <h2 id="connect-heading" className={`${LABEL} mb-3`}>
          Connect with {orgKind === 'label' ? 'an artist' : 'a label'}
        </h2>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label className="block min-w-0 flex-1">
            <span className="sr-only">Their organization’s slug or an owner’s email</span>
            <input
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={`${orgKind === 'label' ? 'Artist' : 'Label'} slug (night-shift) or an owner’s email`}
              maxLength={254}
              className="min-h-9 w-full rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none"
            />
          </label>
          <Button type="submit" variant="secondary" size="sm" loading={sending} disabled={!target.trim()}>
            <Plus size={14} aria-hidden="true" />
            Ask to connect
          </Button>
        </form>
        <p className="mt-2 max-w-xl text-[11px] leading-relaxed text-white/60">
          {orgKind === 'label'
            ? 'They choose what to share with you. Until they accept and pick projects, you see nothing of theirs.'
            : 'You choose what the label can hear. Nothing is shared until you pick it, and you can stop at any time.'}
        </p>
      </section>

      <section aria-labelledby="connections-heading">
        <h2 id="connections-heading" className={`${LABEL} mb-3`}>
          Connections
        </h2>
        {load.state === 'loading' && (
          <p role="status" className="text-[11px] text-white/60">
            Loading connections…
          </p>
        )}
        {load.state === 'failed' && (
          <p role="alert" className="text-[11px] text-[var(--error-text)]">
            {load.message}
          </p>
        )}
        {load.state === 'ready' && load.connections.length === 0 && (
          <p className="rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-5 text-center text-[11px] text-white/40">
            No connections yet.
          </p>
        )}
        {load.state === 'ready' && load.connections.length > 0 && (
          <ListContainer>
            {load.connections.map((c) => (
              <div key={c.id} className="flex flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:gap-4" data-testid={`connection-${c.id}`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white/80">{c.other.name}</p>
                  <p className={`${LABEL} mt-1 truncate`}>
                    {statusLabel(c)}
                    {c.status === 'active' && orgKind === 'artist' ? ` · ${shareSummary(c.shareMode, c.projectIds?.length ?? 0)}` : ''}
                    {c.status === 'active' && orgKind === 'artist' && c.allowCopies ? ' · may copy beats' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {c.canAccept && (
                    <Button variant="secondary" size="sm" loading={busy === c.id} onClick={() => void accept(c)}>
                      Accept
                    </Button>
                  )}
                  {orgKind === 'artist' && (c.status === 'active' || c.status === 'requested') && (
                    <SharingPopover connection={c} projects={load.projects} busy={busy === c.id} onChange={(b) => patchShare(c, b)} />
                  )}
                  {orgKind === 'label' && c.status === 'active' && (
                    <Link
                      href={`/o/${orgSlug}/connections/${c.id}`}
                      className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[10px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
                    >
                      Open shared music
                    </Link>
                  )}
                  <Button variant="ghost" size="sm" disabled={busy === c.id} onClick={() => void end(c)}>
                    {c.status === 'requested' ? (c.initiatedByMe ? 'Withdraw' : 'Decline') : 'End'}
                  </Button>
                </div>
              </div>
            ))}
          </ListContainer>
        )}
      </section>
    </div>
  );
}

/** What this label can reach: the artist's choice, switch by switch (each change saves). */
function SharingPopover({
  connection: c,
  projects,
  busy,
  onChange,
}: {
  connection: ConnectionView;
  projects: Choice[];
  busy: boolean;
  onChange: (body: { share_mode?: ShareMode; project_ids?: string[]; allow_copies?: boolean }) => void;
}) {
  const selected = new Set(c.projectIds ?? []);
  // The shared Popover sits under its trigger without flipping, so the list scrolls inside whatever room is left below it.
  const [room, setRoom] = useState<number | null>(null);
  return (
    <Popover
      width={320}
      align="right"
      label={`What ${c.other.name} can reach`}
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          type="button"
          onClick={(e) => {
            setRoom(Math.max(160, Math.floor(window.innerHeight - e.currentTarget.getBoundingClientRect().bottom - 40)));
            toggle();
          }}
          aria-expanded={open}
          aria-haspopup="dialog"
          disabled={busy}
          className={cn(
            'min-h-9 rounded-lg border px-3 text-[10px] transition-colors duration-[var(--dur-fast)] disabled:opacity-40',
            open ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 bg-white/[0.06] text-white/80 hover:border-white/20 hover:bg-white/[0.10]',
          )}
        >
          Sharing
        </button>
      )}
    >
      <div className="overflow-y-auto p-2" style={{ maxHeight: room ?? undefined }}>
        <p className="px-2 pb-2 pt-1 text-[11px] leading-5 text-[var(--text-readable)]">
          {c.other.name} hears only what is switched on here, and only through their own permissions. They never see your members, contacts, files or notes.
        </p>
        <div className="px-2 pb-2">
          <Dropdown<ShareMode>
            value={c.shareMode}
            onChange={(next) => next !== c.shareMode && onChange({ share_mode: next })}
            options={[
              { value: 'selected', label: 'Selected projects' },
              { value: 'all', label: 'Whole catalogue' },
            ]}
            aria-label="What is shared"
            disabled={busy}
            menuWidth={200}
          />
        </div>
        {c.shareMode === 'selected' &&
          (projects.length === 0 ? (
            <p className="px-2 py-2 text-[11px] text-white/60">You have no projects yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {projects.map((p) => {
                const on = selected.has(p.id);
                return (
                  <li key={p.id}>
                    <SwitchRow
                      label={p.name}
                      on={on}
                      disabled={busy}
                      onToggle={() => onChange({ project_ids: on ? [...selected].filter((id) => id !== p.id) : [...selected, p.id] })}
                    />
                  </li>
                );
              })}
            </ul>
          ))}
        <div className="mt-2 border-t border-white/10 pt-2">
          <SwitchRow label="Let them copy beats into their label" on={c.allowCopies} disabled={busy} onToggle={() => onChange({ allow_copies: !c.allowCopies })} />
        </div>
      </div>
    </Popover>
  );
}

function SwitchRow({ label, on, disabled, onToggle }: { label: string; on: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2 text-left text-[11px] transition-colors hover:bg-white/[0.08] disabled:opacity-40"
    >
      <span className={cn('min-w-0 flex-1 truncate', on ? 'text-white/80' : 'text-white/40')}>{label}</span>
      <span aria-hidden="true" className={cn('relative h-4 w-7 shrink-0 rounded-full border transition-colors', on ? 'border-white/30 bg-white/[0.14]' : 'border-white/10 bg-white/[0.04]')}>
        <span className={cn('absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all', on ? 'left-3.5 bg-white' : 'left-0.5 bg-white/40')} />
      </span>
    </button>
  );
}
