'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Link2, Copy, Trash2, Check, Loader2, ExternalLink, Lock, Clock,
  X, Share2, Music, Pencil, Download, Save, Plus,
} from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { QuickShareModal } from '@/components/share/QuickShareModal';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface ShareLink {
  id: string;
  token: string;
  title?: string;
  kind?: string;
  track_ids: string[];
  plays: number;
  expires_at: string | null;
  allow_downloads: boolean;
  password_hash: string | null;
  created_at: string;
}

/**
 * Share links page — card grid + glass popup detail.
 *
 * Cards show the at-a-glance state (title, kind, plays, expiry chip).
 * Clicking a card opens a glass popup with the full URL + copy / open /
 * native-share / delete actions. The popup is the canonical place to
 * interact with a link; the cards are scan-friendly summaries.
 */
export default function LinksPage() {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);
  // Popup state — null when closed, holds the link object when open.
  // Mirrors the rest of the redesigned modals (Project share, drawer)
  // so the visual language stays consistent.
  const [active, setActive] = useState<ShareLink | null>(null);
  // Multi-select state. Same Set<string> pattern as contacts/library
  // so the floating BatchActionBar feels consistent.
  const [selectedTokens, setSelectedTokens] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // Quick-share modal: lets the user spin up an ad-hoc share over
  // ANY library tracks without making a project or playlist first.
  const [showQuickShare, setShowQuickShare] = useState(false);

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/share');
      const data = await res.json();
      const raw: ShareLink[] = Array.isArray(data) ? data : data.links || [];
      // Sort by plays descending — most-engaged links at the top.
      setLinks(raw.slice().sort((a, b) => (b.plays ?? 0) - (a.plays ?? 0)));
    } catch (err) {
      console.error('Fetch links error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLinks(); }, []);

  const fullUrl = (token: string) => (typeof window !== 'undefined' ? `${window.location.origin}/share/${token}` : `/share/${token}`);

  const copyLink = async (token: string) => {
    const ok = await copyToClipboard(fullUrl(token));
    if (ok) {
      setCopied(token);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const nativeShare = async (link: ShareLink) => {
    const url = fullUrl(link.token);
    const title = link.title || 'Share link';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed the native sheet — fall through to clipboard
        // so the action still produces a useful result.
        copyLink(link.token);
      }
    } else {
      copyLink(link.token);
    }
  };

  const deleteLink = async (token: string) => {
    try {
      await fetch(`/api/share/${token}`, { method: 'DELETE' });
      setLinks((prev) => prev.filter((l) => l.token !== token));
      if (active?.token === token) setActive(null);
      toast.success('Link deleted');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Couldn’t delete link');
    }
  };

  const patchLink = async (token: string, patch: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`/api/share/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { share } = await res.json();
      // Re-merge into local state so cards reflect the edit without
      // a full refetch.
      setLinks((prev) => prev.map((l) => (l.token === token ? { ...l, ...share } : l)));
      if (active?.token === token) setActive((a) => (a ? { ...a, ...share } : a));
      toast.success('Link updated');
      return true;
    } catch (err) {
      console.error('Patch error:', err);
      toast.error('Couldn’t update link', err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  };

  const isExpired = (link: ShareLink) =>
    link.expires_at ? new Date(link.expires_at) < new Date() : false;

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <DashboardLayout>
      <PageContainer className="max-w-[1200px]">
        <PageHeader
          eyebrow="Sharing"
          title="Links"
          description="Every share you've sent. Tap a card to open and copy."
          meta={`${links.length} link${links.length !== 1 ? 's' : ''}${links.length > 0 ? ` · ${links.reduce((s, l) => s + (l.plays ?? 0), 0).toLocaleString()} plays` : ''}`}
          actions={
            <Button
                onClick={() => setShowQuickShare(true)}
                variant="primary"
                leadingIcon={<Plus size={13} aria-hidden="true" />}
              >
                New share
            </Button>
          }
        />

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={18} className="animate-spin text-[#6E685B]" />
          </div>
        ) : links.length === 0 ? (
          <EmptyState
            icon={<Link2 size={24} aria-hidden="true" />}
            title="No share links yet"
            description="Share a project or track to create one."
            action={
              <Button
                onClick={() => setShowQuickShare(true)}
                variant="primary"
                leadingIcon={<Plus size={13} aria-hidden="true" />}
              >
                New share
              </Button>
            }
            className="border-dashed py-32"
          />
        ) : (
          // Card grid — 1 col on mobile, 2 on md, 3 on lg. Each card
          // is a button that opens the glass popup. Top-left corner
          // holds a checkbox for multi-select.
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {links.map((link, idx) => {
              const expired = isExpired(link);
              const selected = selectedTokens.has(link.token);
              const maxPlays = Math.max(...links.map((l) => l.plays ?? 0), 1);
              const playPct = Math.round(((link.plays ?? 0) / maxPlays) * 100);
              const isTop = idx === 0 && (link.plays ?? 0) > 0;
              return (
                <div
                  key={link.token}
                  onClick={() => setActive(link)}
                  className={cn(
                    'group relative text-left rounded-2xl p-4 transition-all cursor-pointer overflow-hidden',
                    'bg-gradient-to-br from-[#171511] to-[#090907] border',
                    selected
                      ? 'border-[#E7D7BE]/40 from-[#342F27]/40'
                      : 'border-[#2B2821] hover:border-[#3B372F] hover:from-[#211F1A]',
                    'active:scale-[0.99]',
                    expired && 'opacity-40',
                  )}
                >
                  {/* Selection checkbox — click swallowed so it doesn't
                      open the popup. Stays visible on hover even when
                      the row isn't selected, so the user knows the
                      affordance exists. */}
                  <div
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTokens((prev) => {
                        const next = new Set(prev);
                        if (next.has(link.token)) next.delete(link.token);
                        else next.add(link.token);
                        return next;
                      });
                    }}
                    className={cn(
                      'absolute top-3 left-3 w-5 h-5 rounded border flex items-center justify-center transition-all z-10',
                      selected
                        ? 'bg-[#E7D7BE] border-[#F3E6D1]'
                        : 'border-[#3B372F] bg-[#090907] opacity-0 group-hover:opacity-100 hover:border-[#837B6D]',
                    )}
                  >
                    {selected && <Check size={11} className="text-black" strokeWidth={3} />}
                  </div>
                  {/* Top row — title + kind + open-in-new shortcut. */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-0.5">
                        {link.title ? (
                          <h3 className="text-[13px] font-medium text-[#F7EBDD] truncate">{link.title}</h3>
                        ) : (
                          <h3 className="text-[13px] font-medium text-[#D0C3AF] truncate font-mono">{link.token}</h3>
                        )}
                        {isTop && (
                          <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E7D7BE]/15 border border-[#E7D7BE]/30 text-[#E7D7BE]">
                            Top
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[#B4AA99] mt-0.5">
                        {link.kind || 'share'} · {link.track_ids?.length ?? 0} track{(link.track_ids?.length ?? 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                    <a
                      href={`/share/${link.token}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#B4AA99] hover:text-white hover:bg-white/[0.04] transition-colors"
                      title="Open share page"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>

                  {/* Bottom row — plays + expiry + flag icons. */}
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[#D0C3AF] tabular-nums font-bold">
                        {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span className="text-[#6E685B]">·</span>
                      {expired ? (
                        <span className="text-red-400 inline-flex items-center gap-1"><Clock size={10} /> Expired</span>
                      ) : link.expires_at ? (
                        <span className="text-[#B4AA99] inline-flex items-center gap-1 min-w-0">
                          <Clock size={10} />
                          <span className="truncate">{formatDate(link.expires_at)}</span>
                        </span>
                      ) : (
                        <span className="text-[#B4AA99]">Never expires</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[#B4AA99] shrink-0">
                      {link.password_hash && <Lock size={10} />}
                      {link.allow_downloads !== false && <span className="text-[9px] uppercase">dl</span>}
                    </div>
                  </div>
                  {/* Engagement bar — relative play share vs most-played link */}
                  <div className="h-1 bg-[#211F1A] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${playPct}%`,
                        background: playPct > 66
                          ? '#E7D7BE'
                          : playPct > 33
                            ? '#C9BCA8'
                            : '#6E685B',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PageContainer>

      {/* Glass popup — opens when a card is clicked. Same surface
          material as the project share modal: backdrop-blur,
          gradient top, radial accent wash, rounded-2xl outline. */}
      {active && (
        <LinkPopup
          link={active}
          onClose={() => setActive(null)}
          onCopy={copyLink}
          onShare={nativeShare}
          onDelete={deleteLink}
          onPatch={patchLink}
          copied={copied === active.token}
          fullUrl={fullUrl(active.token)}
          expired={isExpired(active)}
          formatDate={formatDate}
        />
      )}

      {/* Floating bulk-action bar — appears when ≥1 link is selected.
          Fans out DELETEs in parallel so a 20-link cleanup doesn't
          take 20 sequential round-trips. */}
      <BatchActionBar
        count={selectedTokens.size}
        noun={['link', 'links']}
        onClear={() => setSelectedTokens(new Set())}
        busy={bulkBusy}
        actions={[
          {
            label: 'Delete',
            icon: <DeleteIcon size={11} />,
            intent: 'danger',
            onClick: async () => {
              const tokens = Array.from(selectedTokens);
              const ok = await confirmToast(
                `Delete ${tokens.length} link${tokens.length === 1 ? '' : 's'}?`,
                'Recipients with these URLs will get 404. This is permanent.',
                { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
              );
              if (!ok) return;
              setBulkBusy(true);
              const results = await Promise.allSettled(
                tokens.map((t) => fetch(`/api/share/${t}`, { method: 'DELETE' }).then((r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`);
                })),
              );
              const failed = results.filter((r) => r.status === 'rejected').length;
              setBulkBusy(false);
              setSelectedTokens(new Set());
              setLinks((prev) => prev.filter((l) => !tokens.includes(l.token)));
              if (failed === 0) toast.success(`Deleted ${tokens.length} link${tokens.length === 1 ? '' : 's'}`);
              else toast.warning(`Deleted ${tokens.length - failed}, ${failed} failed`);
            },
          },
        ]}
      />

      {/* Ad-hoc share — pick tracks from the library, generate a
          share link without first needing to make a project or
          playlist. The endpoint accepts a track_ids[] directly. */}
      {showQuickShare && (
        <QuickShareModal
          onClose={() => setShowQuickShare(false)}
          onCreated={() => { setShowQuickShare(false); fetchLinks(); }}
        />
      )}
    </DashboardLayout>
  );
}

/**
 * Glass popup detail. Shows the full URL with a one-tap copy, the
 * link's flags (password / downloads / expiry), and the destructive
 * delete action segregated at the bottom. Native share is offered
 * when the platform supports it (iOS / Android / mobile Safari).
 */
function LinkPopup({
  link, onClose, onCopy, onShare, onDelete, onPatch, copied, fullUrl, expired, formatDate,
}: {
  link: ShareLink;
  onClose: () => void;
  onCopy: (token: string) => void;
  onShare: (link: ShareLink) => void;
  onDelete: (token: string) => void;
  onPatch: (token: string, patch: Record<string, unknown>) => Promise<boolean>;
  copied: boolean;
  fullUrl: string;
  expired: boolean;
  formatDate: (iso: string) => string;
}) {
  // Fetch the share's track titles on open. The card-grid endpoint
  // only carries IDs to keep the list cheap; the popup is where the
  // user looks for "wait, what tracks are on this link?"
  const [tracks, setTracks] = useState<Array<{ id: string; title: string; type: string; cover_url?: string | null }>>([]);
  const [tracksLoading, setTracksLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setTracksLoading(true);
      try {
        // The public share GET works without auth, no password needed
        // since we're the owner viewing our own link.
        const res = await fetch(`/api/share/${link.token}`);
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (!cancelled) setTracks(data.tracks ?? []);
      } catch {
        // Leave empty list — the popup degrades gracefully.
      } finally {
        if (!cancelled) setTracksLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [link.token]);

  // Edit mode: when on, the popup body swaps out for a form. Saving
  // posts a PATCH and flips back to view mode. Title field carries
  // a "(token)" placeholder so the user knows what gets used in the
  // header when title is empty.
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editTitle, setEditTitle] = useState(link.title ?? '');
  const [editAllowDownloads, setEditAllowDownloads] = useState(link.allow_downloads !== false);
  const [editExpiresDays, setEditExpiresDays] = useState<string>(
    link.expires_at ? '7' : '0',
  );
  const [editPassword, setEditPassword] = useState('');
  const [editClearPassword, setEditClearPassword] = useState(false);
  const handleSave = async () => {
    setSavingEdit(true);
    const patch: Record<string, unknown> = {
      title: editTitle.trim(),
      allow_downloads: editAllowDownloads,
      expires_days: Number(editExpiresDays || 0),
    };
    if (editClearPassword) patch.password = null;
    else if (editPassword) patch.password = editPassword;
    const ok = await onPatch(link.token, patch);
    setSavingEdit(false);
    if (ok) {
      setEditing(false);
      setEditPassword('');
      setEditClearPassword(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-0 md:p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'w-full md:max-w-[480px] rounded-t-3xl md:rounded-2xl overflow-hidden relative',
          'bg-gradient-to-b from-[#121210]/95 via-[#0e0d0a]/95 to-[#090907]/98',
          'backdrop-blur-2xl border border-white/[0.06]',
          'shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset]',
          'animate-in slide-in-from-bottom-4 md:zoom-in-95 duration-300',
        )}
      >
        {/* Radial accent wash — same lit-from-corner pattern the
            drawer header and project share modal use. */}
        <div
          className="absolute -top-16 -left-16 w-44 h-44 rounded-full pointer-events-none opacity-25"
          style={{ background: 'radial-gradient(circle, #E7D7BE 0%, transparent 70%)' }}
        />

        <div className="relative z-10 p-5 md:p-6">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#F3E6D1] mb-1">Share link</p>
              <h2 className="text-[18px] font-medium text-white truncate">
                {link.title || `${link.kind || 'Share'} · ${link.track_ids?.length ?? 0} track${(link.track_ids?.length ?? 0) === 1 ? '' : 's'}`}
              </h2>
              <p className="text-[11px] text-[#B4AA99] mt-1">
                Created {formatDate(link.created_at)} · {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#B4AA99] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* URL card — full URL, selectable. Big tappable Copy at
              the right for the dominant action. */}
          <div className="flex items-center gap-2 bg-white/[0.02] border border-[#C9BCA8]/30 rounded-xl px-3 py-2.5 mb-4 backdrop-blur-sm">
            <Link2 size={12} className="text-[#F3E6D1] shrink-0" />
            <input
              readOnly
              value={fullUrl}
              onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              className="flex-1 bg-transparent text-[11px] text-[#F7EBDD] font-mono focus:outline-none truncate"
            />
          </div>

          {/* Flag chips — what's true about this link at a glance. */}
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <FlagChip icon={<Music size={10} />} label={`${link.track_ids?.length ?? 0} track${(link.track_ids?.length ?? 0) === 1 ? '' : 's'}`} />
            {link.password_hash && <FlagChip icon={<Lock size={10} />} label="Password" tone="warn" />}
            {link.allow_downloads !== false && <FlagChip label="Downloads on" />}
            {expired ? (
              <FlagChip icon={<Clock size={10} />} label="Expired" tone="danger" />
            ) : link.expires_at ? (
              <FlagChip icon={<Clock size={10} />} label={`Until ${formatDate(link.expires_at)}`} />
            ) : (
              <FlagChip icon={<Clock size={10} />} label="Never expires" />
            )}
          </div>

          {/* Tracks on this link — small avatar + title row. Empty
              state shown while loading or if the share is empty. */}
          <div className="mb-5">
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-2">Tracks on this link</p>
            {tracksLoading ? (
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#9B9282]">
                <Loader2 size={10} className="animate-spin" />
                Loading…
              </div>
            ) : tracks.length === 0 ? (
              <p className="text-[10px] text-[#6E685B] font-mono">No tracks resolved</p>
            ) : (
              <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {tracks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-[11px] text-[#D0C3AF]">
                    <div className="w-6 h-6 rounded bg-[#090907] border border-[#2B2821] overflow-hidden shrink-0">
                      {t.cover_url ? (
                        <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                          <Music size={10} />
                        </div>
                      )}
                    </div>
                    <span className="truncate flex-1 text-[#F7EBDD]">{t.title}</span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#9B9282] shrink-0">{t.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Edit-mode form. Toggled by the Edit button in the
              secondary action row. */}
          {editing && (
            <div className="mb-5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#F3E6D1]">Edit link</p>

              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-1 block">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={link.token}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-2 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-1 block">Expires in</label>
                  <Dropdown
                    value={editExpiresDays}
                    onChange={(v) => setEditExpiresDays(v)}
                    options={[
                      { value: '0', label: 'Never' },
                      { value: '1', label: '1 day' },
                      { value: '3', label: '3 days' },
                      { value: '7', label: '7 days' },
                      { value: '14', label: '14 days' },
                      { value: '30', label: '30 days' },
                    ]}
                    className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-2 text-[11px] text-[#F7EBDD] focus:outline-none focus:border-[#C9BCA8]"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-1 block">Downloads</label>
                  <button
                    type="button"
                    onClick={() => setEditAllowDownloads((v) => !v)}
                    className={cn(
                      'w-full px-2.5 py-2 text-[11px] font-medium rounded-md border transition-colors flex items-center justify-center gap-1.5',
                      editAllowDownloads
                        ? 'bg-[#342F27] border-[#C9BCA8]/50 text-[#F3E6D1]'
                        : 'bg-[#090907] border-[#2B2821] text-[#9B9282] hover:border-[#3B372F]',
                    )}
                  >
                    <Download size={11} />
                    {editAllowDownloads ? 'Allowed' : 'Off'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-1 flex items-center justify-between">
                  <span>Password {link.password_hash && <span className="text-[#9B9282] normal-case">(currently set)</span>}</span>
                  {link.password_hash && (
                    <button
                      type="button"
                      onClick={() => setEditClearPassword((v) => !v)}
                      className={cn(
                        'text-[9px] uppercase tracking-wider transition-colors',
                        editClearPassword ? 'text-red-400' : 'text-[#B4AA99] hover:text-red-400',
                      )}
                    >
                      {editClearPassword ? 'Will clear' : 'Clear it'}
                    </button>
                  )}
                </label>
                <input
                  type="password"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                  disabled={editClearPassword}
                  placeholder={link.password_hash ? '••••••' : 'No password'}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-2 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] disabled:opacity-40"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={savingEdit}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#E7D7BE] hover:bg-[#F3E6D1] disabled:opacity-40 text-black text-[11px] font-bold uppercase tracking-wider transition-colors"
                >
                  {savingEdit ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setEditPassword(''); setEditClearPassword(false); }}
                  className="px-4 py-2.5 rounded-md border border-[#2B2821] hover:border-[#3B372F] text-[#B4AA99] hover:text-white text-[11px] uppercase tracking-wider transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Primary actions — Copy + Share. Open + Delete sit below
              as quieter secondary affordances. */}
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => onCopy(link.token)}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#F7EBDD] active:scale-[0.98] transition-all"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              onClick={() => onShare(link)}
              className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#F7EBDD] text-[12px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors flex items-center gap-2"
            >
              <Share2 size={13} />
              <span className="hidden sm:inline">Share</span>
            </button>
          </div>

          {/* Secondary row — open / edit / delete. Edit is the middle
              affordance; delete is destructive but quiet. */}
          <div className="flex items-center justify-between gap-2 pt-3 border-t border-white/[0.04]">
            <a
              href={`/share/${link.token}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-[#D0C3AF] hover:text-white transition-colors px-2 py-1"
            >
              <ExternalLink size={11} />
              Open
            </a>
            <button
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#D0C3AF] hover:text-white transition-colors px-2 py-1"
            >
              <Pencil size={11} />
              {editing ? 'Close edit' : 'Edit'}
            </button>
            <button
              onClick={() => onDelete(link.token)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#B4AA99] hover:text-red-400 transition-colors px-2 py-1"
            >
              <Trash2 size={11} />
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Tiny chip used in the popup's flag strip. Three tones: default warm
 * neutral, `warn` for password (caution), `danger` for expired (error).
 */
function FlagChip({ icon, label, tone }: { icon?: React.ReactNode; label: string; tone?: 'warn' | 'danger' }) {
  const cls =
    tone === 'danger' ? 'text-red-400 border-red-500/30' :
    tone === 'warn' ? 'text-[#F3E6D1] border-[#C9BCA8]/30' :
    'text-[#D0C3AF] border-[#3B372F]';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
}
