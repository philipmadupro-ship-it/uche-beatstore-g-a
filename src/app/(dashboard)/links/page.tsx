'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Link2, Copy, Trash2, Check, Loader2, ExternalLink, Lock, Clock,
  X, Share2, Music, Pencil, Download, Save, Plus, Send,
} from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { QuickShareModal } from '@/components/share/QuickShareModal';

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
      setLinks(Array.isArray(data) ? data : data.links || []);
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

  const patchLink = async (token: string, patch: Record<string, any>): Promise<boolean> => {
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
      <div className="max-w-[1200px] mx-auto px-4 md:px-10 pt-6 md:pt-10">
        {/* Header */}
        <div className="relative mb-8 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
          {/* Abstract Image Background */}
          <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-2.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
          
          <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-3">
            <div>
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-2">Sharing</p>
              <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">Links</h1>
              <p className="text-[11px] text-[#a08a6a] max-w-md">Every share you&apos;ve sent. Tap a card to open and copy.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono text-[#E8D8B8] uppercase tracking-wider">
                {links.length} link{links.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={() => setShowQuickShare(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black hover:bg-[#E8DCC8] text-[11px] font-medium transition-colors active:scale-[0.98]"
              >
                <Plus size={13} />
                New share
              </button>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-32">
            <Loader2 size={18} className="animate-spin text-[#3a3328]" />
          </div>
        ) : links.length === 0 ? (
          <div className="text-center py-32 border border-dashed border-[#1f1a13] rounded-lg">
            <Link2 size={24} className="text-[#3a3328] mx-auto mb-4" />
            <p className="text-sm text-[#E8DCC8] mb-1">No share links yet</p>
            <p className="text-[11px] text-[#6a5d4a]">Share a project or track to create one</p>
          </div>
        ) : (
          // Card grid — 1 col on mobile, 2 on md, 3 on lg. Each card
          // is a button that opens the glass popup. Top-left corner
          // holds a checkbox for multi-select.
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {links.map((link) => {
              const expired = isExpired(link);
              const selected = selectedTokens.has(link.token);
              return (
                <div
                  key={link.token}
                  onClick={() => setActive(link)}
                  className={cn(
                    'group relative text-left rounded-2xl p-4 transition-all cursor-pointer',
                    'bg-gradient-to-br from-[#14110d] to-[#0a0907] border',
                    selected
                      ? 'border-[#D4BFA0]/40 from-[#2A2418]/40'
                      : 'border-[#1f1a13] hover:border-[#2d2620] hover:from-[#1a160f]',
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
                        ? 'bg-[#D4BFA0] border-[#E8D8B8]'
                        : 'border-[#2d2620] bg-[#0a0907] opacity-0 group-hover:opacity-100 hover:border-[#4a4338]',
                    )}
                  >
                    {selected && <Check size={11} className="text-black" strokeWidth={3} />}
                  </div>
                  {/* Top row — title + kind + open-in-new shortcut. */}
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="min-w-0 flex-1">
                      {link.title ? (
                        <h3 className="text-[13px] font-medium text-[#E8DCC8] truncate">{link.title}</h3>
                      ) : (
                        <h3 className="text-[13px] font-medium text-[#a08a6a] truncate font-mono">{link.token}</h3>
                      )}
                      <p className="text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a] mt-1">
                        {link.kind || 'share'} · {link.track_ids?.length ?? 0} track{(link.track_ids?.length ?? 0) === 1 ? '' : 's'}
                      </p>
                    </div>
                    <a
                      href={`/share/${link.token}`}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white hover:bg-white/[0.04] transition-colors"
                      title="Open share page"
                    >
                      <ExternalLink size={12} />
                    </a>
                  </div>

                  {/* Bottom row — plays + expiry + flag icons. */}
                  <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[#a08a6a] tabular-nums">
                        {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
                      </span>
                      <span className="text-[#3a3328]">·</span>
                      {expired ? (
                        <span className="text-red-400 inline-flex items-center gap-1"><Clock size={10} /> Expired</span>
                      ) : link.expires_at ? (
                        <span className="text-[#6a5d4a] inline-flex items-center gap-1 min-w-0">
                          <Clock size={10} />
                          <span className="truncate">{formatDate(link.expires_at)}</span>
                        </span>
                      ) : (
                        <span className="text-[#6a5d4a]">Never expires</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 text-[#6a5d4a] shrink-0">
                      {link.password_hash && <Lock size={10} />}
                      {link.allow_downloads !== false && <span className="text-[9px] uppercase">dl</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

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
  onPatch: (token: string, patch: Record<string, any>) => Promise<boolean>;
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
    const patch: Record<string, any> = {
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
          'bg-gradient-to-b from-[#121210]/95 via-[#0e0d0a]/95 to-[#0a0907]/98',
          'backdrop-blur-2xl border border-white/[0.06]',
          'shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(255,255,255,0.03)_inset]',
          'animate-in slide-in-from-bottom-4 md:zoom-in-95 duration-300',
        )}
      >
        {/* Radial accent wash — same lit-from-corner pattern the
            drawer header and project share modal use. */}
        <div
          className="absolute -top-16 -left-16 w-44 h-44 rounded-full pointer-events-none opacity-25"
          style={{ background: 'radial-gradient(circle, #D4BFA0 0%, transparent 70%)' }}
        />

        <div className="relative z-10 p-5 md:p-6">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8] mb-1">Share link</p>
              <h2 className="text-[18px] font-medium text-white truncate">
                {link.title || `${link.kind || 'Share'} · ${link.track_ids?.length ?? 0} track${(link.track_ids?.length ?? 0) === 1 ? '' : 's'}`}
              </h2>
              <p className="text-[11px] text-[#6a5d4a] mt-1">
                Created {formatDate(link.created_at)} · {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full flex items-center justify-center text-[#6a5d4a] hover:text-white bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.06] hover:border-white/[0.12] transition-colors"
            >
              <X size={14} />
            </button>
          </div>

          {/* URL card — full URL, selectable. Big tappable Copy at
              the right for the dominant action. */}
          <div className="flex items-center gap-2 bg-white/[0.02] border border-[#8A7A5C]/30 rounded-xl px-3 py-2.5 mb-4 backdrop-blur-sm">
            <Link2 size={12} className="text-[#E8D8B8] shrink-0" />
            <input
              readOnly
              value={fullUrl}
              onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
              className="flex-1 bg-transparent text-[11px] text-[#E8DCC8] font-mono focus:outline-none truncate"
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
            <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-2">Tracks on this link</p>
            {tracksLoading ? (
              <div className="flex items-center gap-2 text-[10px] font-mono text-[#5a5142]">
                <Loader2 size={10} className="animate-spin" />
                Loading…
              </div>
            ) : tracks.length === 0 ? (
              <p className="text-[10px] text-[#3a3328] font-mono">No tracks resolved</p>
            ) : (
              <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {tracks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-[11px] text-[#a08a6a]">
                    <div className="w-6 h-6 rounded bg-[#0a0907] border border-[#1f1a13] overflow-hidden shrink-0">
                      {t.cover_url ? (
                        <img loading="lazy" src={t.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[#3a3328]">
                          <Music size={10} />
                        </div>
                      )}
                    </div>
                    <span className="truncate flex-1 text-[#E8DCC8]">{t.title}</span>
                    <span className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142] shrink-0">{t.type}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Edit-mode form. Toggled by the Edit button in the
              secondary action row. */}
          {editing && (
            <div className="mb-5 p-4 rounded-xl bg-white/[0.02] border border-white/[0.06] space-y-3">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#E8D8B8]">Edit link</p>

              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] mb-1 block">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder={link.token}
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-2 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] mb-1 block">Expires in</label>
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
                    className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-2 text-[11px] text-[#E8DCC8] focus:outline-none focus:border-[#8A7A5C]"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] mb-1 block">Downloads</label>
                  <button
                    type="button"
                    onClick={() => setEditAllowDownloads((v) => !v)}
                    className={cn(
                      'w-full px-2.5 py-2 text-[11px] font-medium rounded-md border transition-colors flex items-center justify-center gap-1.5',
                      editAllowDownloads
                        ? 'bg-[#2A2418] border-[#8A7A5C]/50 text-[#E8D8B8]'
                        : 'bg-[#0a0907] border-[#1f1a13] text-[#5a5142] hover:border-[#2d2620]',
                    )}
                  >
                    <Download size={11} />
                    {editAllowDownloads ? 'Allowed' : 'Off'}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#6a5d4a] mb-1 flex items-center justify-between">
                  <span>Password {link.password_hash && <span className="text-[#5a5142] normal-case">(currently set)</span>}</span>
                  {link.password_hash && (
                    <button
                      type="button"
                      onClick={() => setEditClearPassword((v) => !v)}
                      className={cn(
                        'text-[9px] uppercase tracking-wider transition-colors',
                        editClearPassword ? 'text-red-400' : 'text-[#6a5d4a] hover:text-red-400',
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
                  className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-md px-2.5 py-2 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] disabled:opacity-40"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={handleSave}
                  disabled={savingEdit}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-md bg-[#D4BFA0] hover:bg-[#E8D8B8] disabled:opacity-40 text-black text-[11px] font-bold uppercase tracking-wider transition-colors"
                >
                  {savingEdit ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
                <button
                  onClick={() => { setEditing(false); setEditPassword(''); setEditClearPassword(false); }}
                  className="px-4 py-2.5 rounded-md border border-[#1f1a13] hover:border-[#2d2620] text-[#6a5d4a] hover:text-white text-[11px] uppercase tracking-wider transition-colors"
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
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-full bg-white text-black text-[12px] font-medium hover:bg-[#E8DCC8] active:scale-[0.98] transition-all"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button
              onClick={() => onShare(link)}
              className="px-4 py-3 rounded-full bg-white/[0.04] border border-white/[0.06] text-[#E8DCC8] text-[12px] font-medium hover:bg-white/[0.08] hover:border-white/[0.12] transition-colors flex items-center gap-2"
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
              className="inline-flex items-center gap-1.5 text-[11px] text-[#a08a6a] hover:text-white transition-colors px-2 py-1"
            >
              <ExternalLink size={11} />
              Open
            </a>
            <button
              onClick={() => setEditing((v) => !v)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#a08a6a] hover:text-white transition-colors px-2 py-1"
            >
              <Pencil size={11} />
              {editing ? 'Close edit' : 'Edit'}
            </button>
            <button
              onClick={() => onDelete(link.token)}
              className="inline-flex items-center gap-1.5 text-[11px] text-[#6a5d4a] hover:text-red-400 transition-colors px-2 py-1"
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
    tone === 'warn' ? 'text-[#E8D8B8] border-[#8A7A5C]/30' :
    'text-[#a08a6a] border-[#2d2620]';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${cls}`}>
      {icon}
      {label}
    </span>
  );
}
