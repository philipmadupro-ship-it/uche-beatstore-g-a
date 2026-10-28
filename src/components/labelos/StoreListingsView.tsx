'use client';

/**
 * Store listings (LABEL-71): the artist's questions ("may this release go on
 * the store?") and, for the store owner, the music of connected artists with
 * Unlist. Draws what the routes sent; every refusal is their words.
 */
import { useCallback, useEffect, useState } from 'react';
import { confirmToast, toast } from '@/hooks/useToast';
import {
  answerListing,
  getConnectedReleases,
  getMyConsents,
  setConnectedRelease,
  type ConnectedRelease,
  type MyConsent,
} from '@/lib/labelos/release-client';
import { connectedStatus, consentStateLabel, myConsentStatus } from '@/lib/labelos/store-consent-copy';
import { cn } from '@/lib/utils';

const LABEL = 'font-mono text-[10px] uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-6 text-center text-[11px] text-white/60';
const BTN =
  'inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.06] px-3 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const ROW = 'flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-4';

type Mine = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'ready'; schemaReady: boolean; consents: MyConsent[] };
type Connected = { state: 'loading' } | { state: 'hidden' } | { state: 'failed'; message: string } | { state: 'ready'; schemaReady: boolean; releases: ConnectedRelease[]; truncated: boolean };

export function StoreListingsView({ orgId, showConnected }: { orgId: string; showConnected: boolean }) {
  const [mine, setMine] = useState<Mine>({ state: 'loading' });
  const [connected, setConnected] = useState<Connected>(showConnected ? { state: 'loading' } : { state: 'hidden' });
  const [busy, setBusy] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    const res = await getMyConsents(orgId);
    setMine(res.ok ? { state: 'ready', schemaReady: res.schemaReady !== false, consents: res.consents } : { state: 'failed', message: res.error });
  }, [orgId]);
  const loadConnected = useCallback(async () => {
    if (!showConnected) return;
    const res = await getConnectedReleases(orgId);
    // Not the store owner (or not a label): the page has nothing to show here, and says nothing about why.
    if (!res.ok) setConnected(res.status === 404 ? { state: 'hidden' } : { state: 'failed', message: res.error });
    else setConnected({ state: 'ready', schemaReady: res.schemaReady, releases: res.releases, truncated: res.truncated === true });
  }, [orgId, showConnected]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, as the sibling panels do
    void loadMine();
    void loadConnected();
  }, [loadMine, loadConnected]);

  const answer = async (c: MyConsent, decision: 'yes' | 'no') => {
    if (decision === 'no') {
      const ok = await confirmToast(`Say no to “${c.title}” on the store?`, 'It comes off the store now, and can only be listed again once you say yes.', { confirmLabel: 'Say no', cancelLabel: 'Cancel', danger: true });
      if (!ok) return;
    }
    setBusy(c.releaseId);
    const res = await answerListing(orgId, c.releaseId, decision);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(decision === 'no' ? 'You said no; the release is off the store' : 'You said yes');
    await loadMine();
  };

  const veto = async (r: ConnectedRelease, listed: boolean) => {
    if (!listed) {
      const ok = await confirmToast(`Take “${r.title}” off your store?`, `It stays off until you allow it again. ${r.artistOrg} is told in its activity.`, { confirmLabel: 'Unlist', cancelLabel: 'Cancel', danger: true });
      if (!ok) return;
    }
    setBusy(r.releaseId);
    const res = await setConnectedRelease(orgId, r.releaseId, listed);
    setBusy(null);
    if (!res.ok) return void toast.error(res.error);
    toast.success(listed ? 'Allowed again' : 'Taken off your store');
    await loadConnected();
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="asked-heading" data-testid="store-asked">
        <h2 id="asked-heading" className={`${LABEL} mb-3`}>Asked of you</h2>
        {mine.state === 'loading' && <p role="status" className="text-[11px] text-white/60">Loading…</p>}
        {mine.state === 'failed' && <p role="alert" className="text-[11px] text-[var(--error-text)]">{mine.message}</p>}
        {mine.state === 'ready' && !mine.schemaReady && <p className={NOTICE} data-testid="store-asked-not-ready">Asking artists about the store needs a database update that is not applied yet.</p>}
        {mine.state === 'ready' && mine.schemaReady && mine.consents.length === 0 && (
          <p className={NOTICE} data-testid="store-asked-empty">Nothing is waiting for your answer. When a release you are credited on is put on the store, you are asked here first.</p>
        )}
        {mine.state === 'ready' && mine.consents.length > 0 && (
          <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#0D0D0A]">
            {mine.consents.map((c) => (
              <li key={c.releaseId} className={ROW} data-testid="store-asked-row" data-state={c.state}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-white/80">{c.title}</p>
                  <p className={`${LABEL} mt-1 break-words`}>
                    {c.type}
                    {c.releaseDate ? ` · ${c.releaseDate}` : ''} · {myConsentStatus(c.state, c.listed)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('text-[11px]', c.state === 'no' ? 'text-white' : 'text-white/60')}>{consentStateLabel(c.state)}</span>
                  {c.state !== 'yes' && (
                    <button type="button" className={BTN} disabled={busy === c.releaseId} onClick={() => void answer(c, 'yes')} data-testid="store-asked-yes">
                      Yes, it can go on the store
                    </button>
                  )}
                  {c.state !== 'no' && (
                    <button type="button" className={BTN} disabled={busy === c.releaseId} onClick={() => void answer(c, 'no')} data-testid="store-asked-no">
                      No
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {connected.state !== 'hidden' && (
        <section aria-labelledby="connected-heading" data-testid="store-connected">
          <h2 id="connected-heading" className={`${LABEL} mb-3`}>Releases from connected artists</h2>
          {connected.state === 'loading' && <p role="status" className="text-[11px] text-white/60">Loading…</p>}
          {connected.state === 'failed' && <p role="alert" className="text-[11px] text-[var(--error-text)]">{connected.message}</p>}
          {connected.state === 'ready' && !connected.schemaReady && (
            <p className="mb-3 text-[11px] text-white/60" data-testid="store-connected-not-ready">Unlisting needs a database update that is not applied yet. You can still see what is on your store.</p>
          )}
          {connected.state === 'ready' && connected.releases.length === 0 && (
            <p className={NOTICE} data-testid="store-connected-empty">No connected artist has put music on your store.</p>
          )}
          {connected.state === 'ready' && connected.releases.length > 0 && (
            <ul className="divide-y divide-white/10 rounded-xl border border-white/10 bg-[#0D0D0A]">
              {connected.releases.map((r) => (
                <li key={r.releaseId} className={ROW} data-testid="store-connected-row" data-serving={r.serving ? 'true' : 'false'}>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-white/80">{r.title}</p>
                    <p className={`${LABEL} mt-1 break-words`}>
                      {r.artist ?? r.artistOrg}
                      {r.artist && r.artistOrg !== r.artist ? ` · ${r.artistOrg}` : ''} · {r.playback === 'full' ? 'full songs' : 'preview clips'} · {connectedStatus(r)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {r.vetoed ? (
                      <button type="button" className={BTN} disabled={busy === r.releaseId || !connected.schemaReady} onClick={() => void veto(r, true)} data-testid="store-connected-allow">
                        Allow again
                      </button>
                    ) : (
                      <button type="button" className={BTN} disabled={busy === r.releaseId || !connected.schemaReady} onClick={() => void veto(r, false)} data-testid="store-connected-unlist">
                        Unlist
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {connected.state === 'ready' && connected.truncated && (
            <p className="mt-2 text-[11px] text-white/40" data-testid="store-connected-truncated">Showing the first {connected.releases.length}: the ones you took off first, then the most recent.</p>
          )}
        </section>
      )}
    </div>
  );
}
