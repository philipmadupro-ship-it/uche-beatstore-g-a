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
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmToast, toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import {
  getReleaseStore,
  listReleaseOnStore,
  unlistReleaseFromStore,
  type StoreState,
} from '@/lib/labelos/release-client';

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

  const load = useCallback(async () => {
    const res = await getReleaseStore(orgId, releaseId);
    if (res.ok) {
      setStore(res);
      // Someone who may not choose full songs never starts on them (an old value on an unlisted release).
      setPlayback(!canManagePublic && !res.listed ? 'preview' : res.playback);
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
                    onClick={() => setPlayback(p.value)}
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
