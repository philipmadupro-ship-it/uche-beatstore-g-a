'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListPlus } from 'lucide-react';
import { ActionMenu, type MenuSection } from '@/components/ui/ActionMenu';
import { toast } from '@/hooks/useToast';
import {
  addToPlaylist,
  buyerIdentityQuery,
  createPlaylist,
  fetchBuyerLibrary,
  removeFromPlaylist,
} from '@/lib/buyer-session';
import {
  buyerPlaylistMembership,
  playlistNameFromTrack,
  type BuyerLibraryPlaylist,
} from '@/lib/store/buyer-library';

/**
 * "Add to playlist" on a storefront beat, for a buyer with an account.
 *
 * Buyer playlists (mig 060) could be created and deleted on
 * /store/account/me, but nothing on the storefront could put a beat in one,
 * so every playlist stayed empty. Renders nothing for an anonymous visitor —
 * there is no account to write to, and a control that only says "sign in"
 * would crowd the play row for the majority who never will.
 *
 * All writes go through `/api/store/me` via lib/buyer-session, which is the
 * only path into buyer_* tables.
 */
export function AddToPlaylistMenu({ trackId, trackTitle }: { trackId: string; trackTitle: string | null }) {
  const [hasIdentity, setHasIdentity] = useState(false);
  const [playlists, setPlaylists] = useState<BuyerLibraryPlaylist[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const library = await fetchBuyerLibrary();
    if (!library) {
      // Identity expired (the helper cleared it) or the read failed.
      setHasIdentity(buyerIdentityQuery() !== null);
      setPlaylists(null);
      return;
    }
    setPlaylists(library.playlists);
  }, []);

  useEffect(() => {
    // localStorage is only readable after mount; reading it during render
    // would make the server and client HTML disagree.
    const present = buyerIdentityQuery() !== null;
    setHasIdentity(present);
    if (present) void load();
  }, [load]);

  if (!hasIdentity) return null;

  const run = async (work: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true);
    try {
      const result = await work();
      if (!result.ok) {
        toast.error('Playlist not updated', result.error);
        return;
      }
      toast.success(done);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const rows = buyerPlaylistMembership(playlists ?? [], trackId);
  const sections: MenuSection[] = [
    {
      id: 'playlists',
      label: 'Your playlists',
      items: rows.map((row) => ({
        id: row.id,
        label: row.name,
        hint: `${row.count} beat${row.count === 1 ? '' : 's'}`,
        checked: row.contains,
        onSelect: () => run(
          () => (row.contains ? removeFromPlaylist(row.id, trackId) : addToPlaylist(row.id, trackId)),
          row.contains ? `Removed from ${row.name}` : `Added to ${row.name}`,
        ),
      })),
    },
    {
      id: 'new',
      items: [{
        id: 'new-playlist',
        label: 'New playlist with this beat',
        hint: 'Named after this beat',
        disabled: playlists === null,
        onSelect: () => run(async () => {
          const created = await createPlaylist(playlistNameFromTrack(trackTitle));
          const playlist = (created.data as { playlist?: { id?: string } } | undefined)?.playlist;
          if (!created.ok || !playlist?.id) return { ok: false, error: created.error };
          return addToPlaylist(playlist.id, trackId);
        }, 'Playlist created'),
      }],
    },
  ];

  return (
    <div className="relative shrink-0">
      <ActionMenu
        align="right"
        width={240}
        label="Add to playlist"
        busy={busy}
        triggerContent={<ListPlus size={14} />}
        triggerClassName="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-white/80 transition-colors hover:border-white/[0.16] hover:bg-white/[0.08] hover:text-white"
        sections={sections}
      />
    </div>
  );
}
