'use client';

/**
 * A release's press kit (LABEL-66), on the release page: the words and photos
 * a journalist sees, the embargo, the share links, and the outreach tracker.
 * Every call is a plain request to a press route followed by a reload; every
 * rule is the server's and its own words are what the toast says. A control
 * appears only for someone the server would let press it (`me`). Single
 * properties are edited in place (`InlineText`); nothing opens a modal.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { InlineText } from '@/components/ui/InlineText';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  addKitLink, addKitPhoto, addOutreachRow, createKitShare, fetchPress, patchKitPhoto, patchOutreachRow, removeKitLink, removeKitPhoto,
  removeOutreachRow, revokeKitShare, saveKit, type PressResult, type PressState,
} from '@/lib/labelos/press-client';
import { PRESS_LIMITS, embargoState } from '@/lib/labelos/press';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';
const FIELD = 'h-8 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 text-[11px] text-white/80 placeholder:text-white/30 focus:border-white/30 focus:outline-none';
const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/70 transition-colors hover:border-white/20 hover:bg-white/[0.10] hover:text-white disabled:opacity-40';
const ICON_BTN = 'grid size-7 shrink-0 place-items-center rounded-lg text-white/50 transition-colors hover:bg-white/[0.10] hover:text-white disabled:opacity-30';
const STAGE_LABEL = { planned: 'Planned', sent: 'Sent', opened: 'Opened', replied: 'Replied' } as const;

type Ready = Extract<PressState, { schemaReady: true }>;

/** `datetime-local` wants local wall time without a zone; the server wants an instant. */
const toLocalInput = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export function PressKitPanel({ orgId, releaseId }: { orgId: string; releaseId: string }) {
  const [state, setState] = useState<PressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The path of a link made a moment ago: shown once, because only its hash is stored. */
  const [fresh, setFresh] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchPress(orgId, releaseId);
    if (res.ok) {
      setState(res.state);
      setError(null);
    } else setError(res.error);
  }, [orgId, releaseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (run: () => Promise<PressResult<object>>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await run();
        if (!res.ok) {
          toast.error(res.error);
          return false;
        }
        if (success) toast.success(success);
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  if (error && !state) return <section className={CARD} data-testid="press-kit"><p className="text-[11px] text-white/60" role="alert">{error}</p></section>;
  if (!state) return <section className={CARD} data-testid="press-kit" aria-busy="true"><p className={LABEL}>Press</p></section>;
  if (!state.schemaReady) {
    return (
      <section className={CARD} data-testid="press-kit" data-ready="false">
        <h2 className={`${LABEL} mb-2`}>Press</h2>
        <p className="text-[11px] leading-relaxed text-white/60">Press kits are not set up for this workspace yet.</p>
      </section>
    );
  }
  const s: Ready = state;
  const canWrite = s.me.canWrite;
  const kit = s.kit;
  const embargo = embargoState(kit?.embargoAt, new Date());

  return (
    <section aria-labelledby="release-press" className="space-y-4" data-testid="press-kit" data-ready="true">
      <h2 id="release-press" className="font-heading text-[20px] font-bold tracking-tight text-white">Press</h2>

      <div className={CARD}>
        <h3 className={`${LABEL} mb-3`}>Press kit</h3>
        <div className="space-y-4">
          <div>
            <p className={`${LABEL} mb-1`}>Headline</p>
            {canWrite ? (
              <InlineText label="Headline" value={kit?.headline ?? ''} maxLength={PRESS_LIMITS.headline} placeholder="One line a journalist can quote" emptyLabel="Add a headline" className="text-[13px] text-white/80" onSave={(v) => act(() => saveKit(orgId, releaseId, { headline: v }))} />
            ) : (
              <p className="text-[13px] text-white/80">{kit?.headline ?? '—'}</p>
            )}
          </div>
          <div>
            <p className={`${LABEL} mb-1`}>Bio</p>
            {canWrite ? (
              <InlineText label="Bio" multiline rows={6} value={kit?.bio ?? ''} maxLength={PRESS_LIMITS.bio} placeholder="Artist and release bio" emptyLabel="Add a bio" className="whitespace-pre-line text-[11px] leading-relaxed text-white/70" onSave={(v) => act(() => saveKit(orgId, releaseId, { bio: v }))} />
            ) : (
              <p className="whitespace-pre-line text-[11px] leading-relaxed text-white/70">{kit?.bio ?? '—'}</p>
            )}
          </div>
        </div>
      </div>

      <div className={CARD} data-testid="press-embargo">
        <h3 className={`${LABEL} mb-1`}>Embargo</h3>
        <p className="mb-3 text-[11px] leading-relaxed text-white/60">
          Until this moment a shared page shows only the title, the line below and photos marked “before embargo”. No date, tracklist, bio or audio.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="datetime-local"
            aria-label="Embargo lifts at"
            defaultValue={toLocalInput(kit?.embargoAt ?? null)}
            key={kit?.embargoAt ?? 'none'}
            disabled={!canWrite || busy}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const d = new Date(v);
              if (!Number.isNaN(d.getTime())) void act(() => saveKit(orgId, releaseId, { embargo_at: d.toISOString() }), 'Embargo saved.');
            }}
            className={FIELD}
          />
          {canWrite && kit?.embargoAt && (
            <button type="button" disabled={busy} onClick={() => void act(() => saveKit(orgId, releaseId, { embargo_at: null }), 'Embargo removed.')} className={BTN}>Remove embargo</button>
          )}
          <span className={cn('text-[11px]', embargo === 'active' ? 'text-[#c8a47a]' : 'text-white/50')} data-testid="press-embargo-state">
            {embargo === 'active' ? 'Embargoed' : embargo === 'lifted' ? 'Lifted' : 'No embargo'}
          </span>
        </div>
        <div className="mt-3">
          <p className={`${LABEL} mb-1`}>Line shown before it lifts</p>
          {canWrite ? (
            <InlineText label="Line before embargo" value={kit?.preEmbargoNote ?? ''} maxLength={PRESS_LIMITS.note} placeholder="e.g. New single, coming soon" emptyLabel="Add a line" className="text-[11px] text-white/70" onSave={(v) => act(() => saveKit(orgId, releaseId, { pre_embargo_note: v }))} />
          ) : (
            <p className="text-[11px] text-white/70">{kit?.preEmbargoNote ?? '—'}</p>
          )}
        </div>
      </div>

      <div className={CARD}>
        <h3 className={`${LABEL} mb-3`}>Photos</h3>
        {s.photos.length === 0 ? (
          <p className="text-[11px] text-white/50">No photos yet. Photos come from this release’s project files (artwork or photo, not restricted).</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {s.photos.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="press-photo">
                <span className="min-w-0 flex-1 truncate text-[11px] text-white/80">{p.label}</span>
                {canWrite ? (
                  <>
                    <InlineText label={`Caption for ${p.label}`} value={p.caption ?? ''} maxLength={PRESS_LIMITS.caption} placeholder="Caption" emptyLabel="Add caption" className="text-[11px] text-white/60" onSave={(v) => act(() => patchKitPhoto(orgId, releaseId, p.id, { caption: v }))} />
                    <label className="flex items-center gap-1.5 text-[11px] text-white/60">
                      <input type="checkbox" checked={p.preEmbargo} disabled={busy} onChange={(e) => void act(() => patchKitPhoto(orgId, releaseId, p.id, { pre_embargo: e.target.checked }))} />
                      Before embargo
                    </label>
                    <button type="button" aria-label={`Remove ${p.label}`} disabled={busy} onClick={() => void act(() => removeKitPhoto(orgId, releaseId, p.id), 'Photo removed.')} className={ICON_BTN}><X size={14} aria-hidden /></button>
                  </>
                ) : (
                  <span className="text-[11px] text-white/50">{p.preEmbargo ? 'Before embargo' : ''}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && (() => {
          const used = new Set(s.photos.map((p) => p.label));
          const options = s.photoChoices.filter((c) => !used.has(c.label)).map((c) => ({ value: c.id, label: c.label }));
          return options.length > 0 ? (
            <div className="mt-3">
              <Dropdown<string> value="" placeholder="Add a photo…" aria-label="Add a photo" options={options} onChange={(id) => id && void act(() => addKitPhoto(orgId, releaseId, { asset_id: id }), 'Photo added.')} />
            </div>
          ) : null;
        })()}
      </div>

      <LinksCard s={s} canWrite={canWrite} busy={busy} act={act} orgId={orgId} releaseId={releaseId} />

      <SharesCard s={s} canWrite={canWrite} busy={busy} act={act} orgId={orgId} releaseId={releaseId} fresh={fresh} setFresh={setFresh} reload={load} />

      {s.outreach && <OutreachCard s={s} canWrite={canWrite} busy={busy} act={act} orgId={orgId} releaseId={releaseId} />}
    </section>
  );
}

type CardProps = { s: Ready; canWrite: boolean; busy: boolean; act: (run: () => Promise<PressResult<object>>, success?: string) => Promise<boolean>; orgId: string; releaseId: string };

function LinksCard({ s, canWrite, busy, act, orgId, releaseId }: CardProps) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  return (
    <div className={CARD}>
      <h3 className={`${LABEL} mb-3`}>Links</h3>
      {s.links.length === 0 && <p className="text-[11px] text-white/50">No links yet.</p>}
      <ul className="divide-y divide-white/10">
        {s.links.map((l) => (
          <li key={l.id} className="flex items-center gap-3 py-2">
            <span className="w-28 shrink-0 truncate text-[11px] text-white/80">{l.label}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-white/50">{l.url}</span>
            {canWrite && <button type="button" aria-label={`Remove ${l.label}`} disabled={busy} onClick={() => void act(() => removeKitLink(orgId, releaseId, l.id), 'Link removed.')} className={ICON_BTN}><X size={14} aria-hidden /></button>}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act(() => addKitLink(orgId, releaseId, { label: label.trim(), url: url.trim() }), 'Link added.')) {
              setLabel('');
              setUrl('');
            }
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Link label" maxLength={PRESS_LIMITS.label} className={cn(FIELD, 'w-32')} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" aria-label="Link address" maxLength={PRESS_LIMITS.url} className={cn(FIELD, 'min-w-[12rem] flex-1')} />
          <button type="submit" disabled={!label.trim() || !url.trim() || busy} className={BTN}>Add</button>
        </form>
      )}
    </div>
  );
}

const EXPIRY = [
  { value: 'never', label: 'No expiry', days: 0 },
  { value: '7', label: '7 days', days: 7 },
  { value: '30', label: '30 days', days: 30 },
] as const;

function SharesCard({ s, canWrite, busy, act, orgId, releaseId, fresh, setFresh, reload }: CardProps & { fresh: string | null; setFresh: (v: string | null) => void; reload: () => Promise<void> }) {
  const [label, setLabel] = useState('');
  const [expiry, setExpiry] = useState<string>('never');
  const [copied, setCopied] = useState(false);
  const url = fresh ? `${typeof window === 'undefined' ? '' : window.location.origin}${fresh}` : null;
  return (
    <div className={CARD} data-testid="press-shares">
      <h3 className={`${LABEL} mb-1`}>Share links</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-white/60">Anyone with a link sees the kit (respecting the embargo) without an account. Make one per outlet so you can revoke it alone.</p>
      {url && (
        <div className="mb-3 rounded-lg border border-white/20 bg-white/[0.06] p-3" data-testid="press-fresh-link" role="status">
          <p className="mb-1 text-[11px] text-white/60">Copy it now: it is shown once.</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-[11px] text-white/80">{url}</code>
            <button type="button" className={BTN} onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { toast.error('Copy failed — select the address and copy it.'); } }}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy'}
            </button>
            <button type="button" aria-label="Hide the link" className={ICON_BTN} onClick={() => { setFresh(null); setCopied(false); }}><X size={14} aria-hidden /></button>
          </div>
        </div>
      )}
      {s.shares.length === 0 && <p className="text-[11px] text-white/50">No links yet.</p>}
      <ul className="divide-y divide-white/10">
        {s.shares.map((sh) => (
          <li key={sh.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="press-share" data-state={sh.state}>
            <span className="min-w-0 flex-1 truncate text-[11px] text-white/80">{sh.label}</span>
            <span className="text-[10px] text-white/40">
              {sh.state === 'live' ? (sh.expiresAt ? `Expires ${when(sh.expiresAt)}` : 'No expiry') : sh.state === 'revoked' ? 'Revoked' : 'Expired'}
              {' · '}{sh.views} {sh.views === 1 ? 'view' : 'views'}
            </span>
            {canWrite && sh.state === 'live' && (
              <button type="button" disabled={busy} onClick={() => void act(() => revokeKitShare(orgId, releaseId, sh.id), 'Link revoked.')} className={BTN}>Revoke</button>
            )}
          </li>
        ))}
      </ul>
      {canWrite && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const days = EXPIRY.find((x) => x.value === expiry)?.days ?? 0;
            const res = await createKitShare(orgId, releaseId, { label: label.trim(), expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null });
            if (!res.ok) return toast.error(res.error);
            setFresh(res.path);
            setCopied(false);
            setLabel('');
            await reload();
          }}
        >
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Who is it for? (e.g. Pitchfork)" aria-label="Link label" maxLength={PRESS_LIMITS.label} className={cn(FIELD, 'min-w-[12rem] flex-1')} />
          <Dropdown<string> value={expiry} aria-label="Expiry" options={EXPIRY.map((x) => ({ value: x.value, label: x.label }))} onChange={setExpiry} />
          <button type="submit" disabled={!label.trim() || busy} className={BTN}>Make link</button>
        </form>
      )}
    </div>
  );
}

function OutreachCard({ s, canWrite, busy, act, orgId, releaseId }: CardProps) {
  const o = s.outreach!;
  const used = new Set(o.rows.map((r) => r.contactId));
  const options = o.contacts.filter((c) => !used.has(c.id)).map((c) => ({ value: c.id, label: c.outlet ? `${c.name} · ${c.outlet}` : c.name }));
  return (
    <div className={CARD} data-testid="press-outreach">
      <h3 className={`${LABEL} mb-1`}>Outreach</h3>
      <p className="mb-3 text-[11px] leading-relaxed text-white/60">
        Record who you sent the kit to and what came back. Nothing is sent from here. “Opened” is ticked by hand, because there is no signal to read it from.
      </p>
      {o.rows.length === 0 && (
        <p className="text-[11px] text-white/50">
          {o.contacts.length === 0 ? 'No press contacts yet. Add a contact with the role “press” in the organization’s directory.' : 'Nobody on this release yet.'}
        </p>
      )}
      <ul className="divide-y divide-white/10">
        {o.rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="press-outreach-row" data-stage={r.stage}>
            <span className="min-w-0 flex-1 truncate text-[11px] text-white/80">{r.name}{r.outlet ? <span className="text-white/40"> · {r.outlet}</span> : null}</span>
            <span className="text-[10px] uppercase tracking-wide text-white/50" data-testid="press-outreach-stage">{STAGE_LABEL[r.stage]}</span>
            {canWrite && (
              <>
                <label className="flex items-center gap-1.5 text-[11px] text-white/60"><input type="checkbox" checked={!!r.sentAt} disabled={busy} onChange={(e) => void act(() => patchOutreachRow(orgId, releaseId, r.id, { sent: e.target.checked }))} /> Sent</label>
                <label className="flex items-center gap-1.5 text-[11px] text-white/60"><input type="checkbox" checked={!!r.openedAt} disabled={busy} onChange={(e) => void act(() => patchOutreachRow(orgId, releaseId, r.id, { opened: e.target.checked }))} /> Opened</label>
                <label className="flex items-center gap-1.5 text-[11px] text-white/60"><input type="checkbox" checked={!!r.repliedAt} disabled={busy} onChange={(e) => void act(() => patchOutreachRow(orgId, releaseId, r.id, { replied: e.target.checked }))} /> Replied</label>
                <InlineText label={`Coverage link for ${r.name}`} value={r.coverageUrl ?? ''} maxLength={PRESS_LIMITS.url} placeholder="https://…" emptyLabel="Add coverage link" className="max-w-[16rem] truncate text-[11px] text-white/60" onSave={(v) => act(() => patchOutreachRow(orgId, releaseId, r.id, { coverage_url: v }))} />
                <button type="button" aria-label={`Remove ${r.name}`} disabled={busy} onClick={() => void act(() => removeOutreachRow(orgId, releaseId, r.id), 'Contact removed.')} className={ICON_BTN}><X size={14} aria-hidden /></button>
              </>
            )}
            {!canWrite && r.coverageUrl && <a href={r.coverageUrl} target="_blank" rel="noopener noreferrer nofollow" className="text-[11px] text-white/70 underline">Coverage</a>}
          </li>
        ))}
      </ul>
      {canWrite && options.length > 0 && (
        <div className="mt-3">
          <Dropdown<string> value="" placeholder="Add a press contact…" aria-label="Add a press contact" options={options} onChange={(id) => id && void act(() => addOutreachRow(orgId, releaseId, { contact_id: id }), 'Contact added.')} />
        </div>
      )}
    </div>
  );
}
