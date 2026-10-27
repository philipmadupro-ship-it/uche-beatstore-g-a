'use client';

/**
 * "On the store" (LABEL-42): put a released release on the public storefront,
 * choose whether visitors hear a preview clip or the whole recording, and take
 * it off again. Everything is the server's: whether this release can be listed
 * (`canList`, with its own words when it cannot), what unlisting would delete
 * and whether the owner is asked. The card draws nothing for an org whose
 * releases can never be listed (label- and artist-owned stores are a later
 * phase), so it never offers a button that only ever answers 409.
 *
 * Playback is two buttons, not a Dropdown: a Dropdown portals to <body>, and
 * inside a Popover that reads as an outside click.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  answerListing,
  getReleaseStore,
  listReleaseOnStore,
  unlistReleaseFromStore,
  type ListedAnswer,
  type StoreState,
} from '@/lib/labelos/release-client';
import { consentSentence, consentStateLabel, unreachableSentence } from '@/lib/labelos/store-consent-copy';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const CARD = 'rounded-xl border border-white/10 bg-[#0D0D0A] p-4';

const PLAYBACKS = [
  { value: 'preview', label: 'Preview clips', hint: 'Visitors hear a 75 second clip of each song.' },
  { value: 'full', label: 'Full songs', hint: 'Visitors hear each whole recording, streamed from our server.' },
] as const;

export function ReleaseStoreCard({
  orgId,
  releaseId,
  canWrite,
  canManagePublic,
  imported,
}: {
  orgId: string;
  releaseId: string;
  canWrite: boolean;
  /** Owner or admin: choosing full songs, and any change to an imported release, are theirs. */
  canManagePublic: boolean;
  imported: boolean;
}) {
  const router = useRouter();
  const [store, setStore] = useState<StoreState | null>(null);
  const [playback, setPlayback] = useState<'preview' | 'full'>('preview');
  const [busy, setBusy] = useState(false);
  // What the last listing did about the artists (LABEL-71): shown until the card is left.
  const [asked, setAsked] = useState<ListedAnswer['consent'] | null>(null);
  // True once the member has clicked a playback choice: a load that lands after that (a slower second
  // request — StrictMode runs the mount effect twice — or a refetch) must not put the server's value back.
  const picked = useRef(false);

  const load = useCallback(async () => {
    const res = await getReleaseStore(orgId, releaseId);
    if (res.ok) {
      setStore(res);
      // Someone who may not choose full songs never starts on them (an old value on an unlisted release).
      if (!picked.current) setPlayback(!canManagePublic && !res.listed ? 'preview' : res.playback);
    }
  }, [orgId, releaseId, canManagePublic]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, as the sibling panels do
    void load();
  }, [load]);

  if (!store) return null;
  // This org's releases can never be listed: say nothing rather than offer a dead button.
  if (!store.listed && !store.canList.ok && store.canList.field === 'org') return null;

  const list = async () => {
    setBusy(true);
    const res = await listReleaseOnStore(orgId, releaseId, playback);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(store.listed ? 'Store listing updated' : 'On the store');
    setAsked(res.consent ?? null);
    picked.current = false; // what was saved is now the server's value
    await load();
    router.refresh();
  };

  const unlist = async () => {
    const deletePreviews = store.unlist.askToDeletePreviews
      ? await confirmToast('Delete the public previews too?', 'This music was not publicly out yet. Keeping them leaves the clips in the public bucket.', {
          confirmLabel: 'Delete previews',
          cancelLabel: 'Keep them',
        })
      : false;
    setBusy(true);
    const res = await unlistReleaseFromStore(orgId, releaseId, deletePreviews);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success('Taken off the store');
    await load();
    router.refresh();
  };

  const answer = async (decision: 'yes' | 'no') => {
    if (decision === 'no') {
      const ok = await confirmToast('Say no to the store?', 'The release comes off the store now. It can only be listed again once you say yes.', { confirmLabel: 'Say no', cancelLabel: 'Cancel' });
      if (!ok) return;
    }
    setBusy(true);
    const res = await answerListing(orgId, releaseId, decision);
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    toast.success(decision === 'no' ? 'You said no; the release is off the store' : 'You said yes');
    await load();
    router.refresh();
  };

  // The server refuses these for anyone else (403); the card says so up front instead of offering a dead button.
  const importedLocked = imported && !canManagePublic;
  const fullLocked = !canManagePublic;
  const mayAct = canWrite && !importedLocked;

  return (
    <section aria-labelledby="release-store" className={CARD} data-testid="release-store" data-listed={store.listed ? 'true' : 'false'}>
      <h2 id="release-store" className={`${LABEL} mb-3`}>On the store</h2>
      <p className="text-[13px] text-white" data-testid="release-store-state">
        {store.listed ? 'Listed on the public store' : 'Not on the store'}
      </p>
      {!store.listed && !store.canList.ok && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="release-store-blocked">{store.canList.error}</p>
      )}
      {store.vetoed && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="release-store-vetoed">The store owner has taken this release off their store.</p>
      )}
      {store.consent?.schemaReady && store.consent.status !== 'none' && (
        <div className="mt-3" data-testid="release-store-consent" data-status={store.consent.status}>
          <p className={`${LABEL} mb-1`}>The artists’ say</p>
          <p className="text-[11px] text-white/60">{consentSentence(store.consent.status)}</p>
          <ul className="mt-2 space-y-1">
            {store.consent.artists.map((a) => (
              <li key={a.contactId} className="flex items-center justify-between gap-3 text-[11px] text-white/80" data-testid="release-store-consent-artist" data-state={a.state}>
                <span className="truncate">{a.name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn('text-[11px]', a.state === 'no' ? 'text-white' : 'text-white/60')}>{consentStateLabel(a.state)}</span>
                  {a.mine && (
                    <>
                      {a.state !== 'yes' && (
                        <button type="button" disabled={busy} onClick={() => void answer('yes')} className={BTN} data-testid="release-store-consent-yes">
                          Yes
                        </button>
                      )}
                      {a.state !== 'no' && (
                        <button type="button" disabled={busy} onClick={() => void answer('no')} className={BTN} data-testid="release-store-consent-no">
                          No
                        </button>
                      )}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {asked && asked.schemaReady && (asked.asked ?? 0) > 0 && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="release-store-asked">
          {unreachableSentence({ asked: asked.asked ?? 0, notified: asked.notified ?? 0, unreachable: asked.unreachable ?? 0 })}
        </p>
      )}
      {canWrite && importedLocked && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="release-store-owner-only">
          This release was entered as already out, so only an owner or an admin can put it on the store or take it off.
        </p>
      )}
      {mayAct && (store.listed || store.canList.ok) && (
        <>
          {store.playbackChoice ? (
            <div className="mt-3" role="radiogroup" aria-label="How visitors hear it">
              <div className="flex gap-2">
                {PLAYBACKS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={playback === p.value}
                    disabled={p.value === 'full' && fullLocked}
                    title={p.value === 'full' && fullLocked ? 'Only an owner or an admin can choose full songs' : undefined}
                    onClick={() => {
                      picked.current = true;
                      setPlayback(p.value);
                    }}
                    className={cn(BTN, playback === p.value && 'border-white/30 bg-white/[0.14] text-white')}
                    data-testid={`release-store-playback-${p.value}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-white/40">{PLAYBACKS.find((p) => p.value === playback)?.hint}</p>
              {fullLocked && <p className="mt-1 text-[11px] text-white/40" data-testid="release-store-full-locked">Full songs are chosen by an owner or an admin.</p>}
            </div>
          ) : (
            <p className="mt-3 text-[11px] text-white/40">Visitors hear a preview clip of each song.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy || (store.listed && playback === store.playback)} onClick={() => void list()} className={BTN} data-testid="release-store-list">
              {store.listed ? 'Save playback' : 'Put on the store'}
            </button>
            {store.listed && (
              <button type="button" disabled={busy} onClick={() => void unlist()} className={BTN} data-testid="release-store-unlist">
                Take off the store
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
