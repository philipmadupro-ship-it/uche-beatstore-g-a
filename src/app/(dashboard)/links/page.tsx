'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Link2, Copy, Trash2, Check, Loader2, ExternalLink, Lock, Clock,
  X, Share2, Music, Pencil, Download, Save, Plus, Search, BarChart3,
} from 'lucide-react';
import { toast, confirmToast } from '@/hooks/useToast';
import { Dropdown } from '@/components/ui/Dropdown';
import { copyToClipboard } from '@/lib/clipboard';
import { cn } from '@/lib/utils';
import { BatchActionBar, DeleteIcon } from '@/components/ui/BatchActionBar';
import { ListContainer, ListRow } from '@/components/ui/ListRow';
import { QuickShareModal } from '@/components/share/QuickShareModal';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

interface ShareLink {
  id: string;
  source: 'share_links' | 'project_shares';
  token: string;
  title: string | null;
  content_title: string | null;
  kind: string;
  track_ids: string[];
  tracks: Array<{ id: string; title: string; type: string }>;
  plays: number;
  expires_at: string | null;
  revoked_at: string | null;
  allow_downloads: boolean;
  password_protected: boolean;
  created_at: string;
  href: string;
}

const LINK_FILTERS = ['All', 'Active', 'Expired', 'Protected', 'Downloads'] as const;
type LinkFilter = (typeof LINK_FILTERS)[number];

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
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LinkFilter>('All');

  const fetchLinks = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/links');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
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

  const linkKey = (link: ShareLink) => `${link.source}:${link.id}`;
  const fullUrl = (link: ShareLink) =>
    typeof window !== 'undefined' ? `${window.location.origin}${link.href}` : link.href;

  const copyLink = async (link: ShareLink) => {
    const ok = await copyToClipboard(fullUrl(link));
    if (ok) {
      const key = linkKey(link);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  const nativeShare = async (link: ShareLink) => {
    const url = fullUrl(link);
    const title = link.title || 'Share link';
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
      } catch {
        // User dismissed the native sheet — fall through to clipboard
        // so the action still produces a useful result.
        copyLink(link);
      }
    } else {
      copyLink(link);
    }
  };

  const deleteLink = async (link: ShareLink) => {
    try {
      const endpoint =
        link.source === 'project_shares' ? `/api/shares/${link.id}` : `/api/share/${link.token}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const key = linkKey(link);
      setLinks((prev) => prev.filter((item) => linkKey(item) !== key));
      if (active && linkKey(active) === key) setActive(null);
      toast.success('Link deleted');
    } catch (err) {
      console.error('Delete error:', err);
      toast.error('Couldn’t delete link');
    }
  };

  const patchLink = async (link: ShareLink, patch: Record<string, unknown>): Promise<boolean> => {
    try {
      const projectPatch =
        link.source === 'project_shares'
          ? {
              label: patch.title,
              allow_downloads: patch.allow_downloads,
            }
          : patch;
      const endpoint =
        link.source === 'project_shares' ? `/api/shares/${link.id}` : `/api/share/${link.token}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(projectPatch),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { share } = await res.json();
      const normalizedShare =
        link.source === 'project_shares'
          ? {
              title: share.label ?? link.content_title,
              allow_downloads: share.allow_downloads,
              expires_at: share.expires_at,
              revoked_at: share.revoked_at,
            }
          : share;
      const key = linkKey(link);
      // Re-merge into local state so cards reflect the edit without
      // a full refetch.
      setLinks((prev) => prev.map((item) => (linkKey(item) === key ? { ...item, ...normalizedShare } : item)));
      if (active && linkKey(active) === key) {
        setActive((current) => (current ? { ...current, ...normalizedShare } : current));
      }
      toast.success('Link updated');
      return true;
    } catch (err) {
      console.error('Patch error:', err);
      toast.error('Couldn’t update link', err instanceof Error ? err.message : 'Unknown error');
      return false;
    }
  };

  const isExpired = (link: ShareLink) =>
    Boolean(link.revoked_at) || (link.expires_at ? new Date(link.expires_at) < new Date() : false);

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const linkSummary = useMemo(() => {
    return links.reduce(
      (acc, link) => {
        acc.plays += link.plays ?? 0;
        if (!isExpired(link)) acc.active += 1;
        if (link.password_protected) acc.protected += 1;
        if (link.allow_downloads !== false) acc.downloadable += 1;
        return acc;
      },
      { plays: 0, active: 0, protected: 0, downloadable: 0 },
    );
  }, [links]);

  const visibleLinks = useMemo(() => {
    const q = search.trim().toLowerCase();
    return links.filter((link) => {
      const expired = isExpired(link);
      if (filter === 'Active' && expired) return false;
      if (filter === 'Expired' && !expired) return false;
      if (filter === 'Protected' && !link.password_protected) return false;
      if (filter === 'Downloads' && link.allow_downloads === false) return false;
      if (q) {
        const haystack = `${link.title ?? ''} ${link.token} ${link.kind ?? ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [links, filter, search]);

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

        {!loading && links.length > 0 && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <LinkMetric label="Links" value={links.length.toLocaleString()} icon={<Link2 size={13} />} />
              <LinkMetric label="Active" value={linkSummary.active.toLocaleString()} icon={<Clock size={13} />} />
              <LinkMetric label="Plays" value={linkSummary.plays.toLocaleString()} icon={<BarChart3 size={13} />} tone="good" />
              <LinkMetric label="Downloads" value={linkSummary.downloadable.toLocaleString()} icon={<Download size={13} />} />
            </div>

            <div className="mb-5 rounded-2xl border border-[#2B2821] bg-[#11100D] p-2.5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title, token, kind…"
                    className="w-full rounded-full border border-[#2B2821] bg-[#090907] py-2 pl-8 pr-3 text-[12px] text-[#F7EBDD] transition-colors placeholder:text-[#6E685B] focus:border-[#C9BCA8] focus:outline-none"
                  />
                </div>
                <div className="flex overflow-x-auto rounded-full border border-[#2B2821] bg-[#090907] p-1">
                  {LINK_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFilter(f)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                        filter === f ? 'bg-[#342F27] text-[#F3E6D1]' : 'text-[#B4AA99] hover:text-[#F7EBDD]'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between px-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-[#6E685B]">
                  {visibleLinks.length} shown
                  {visibleLinks.length !== links.length && ` · ${links.length} total`}
                </p>
                {(search.trim() || filter !== 'All') && (
                  <button
                    type="button"
                    onClick={() => { setSearch(''); setFilter('All'); }}
                    className="text-[10px] font-mono uppercase tracking-[0.16em] text-[#B4AA99] transition-colors hover:text-[#F7EBDD]"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          </>
        )}

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
        ) : visibleLinks.length === 0 ? (
          <EmptyState
            icon={<Search size={24} aria-hidden="true" />}
            title="No matching links"
            description="Clear the search or switch filters to see the rest of your share links."
            className="border-dashed py-24"
          />
        ) : (
          <>
          {/* Below lg: unified list rows — same language as the rest of the app. */}
          <ListContainer className="lg:hidden">
            {visibleLinks.map((link, idx) => {
              const expired = isExpired(link);
              const key = linkKey(link);
              const selected = selectedTokens.has(key);
              const isTop = idx === 0 && (link.plays ?? 0) > 0;
              return (
                <ListRow
                  key={key}
                  onClick={() => setActive(link)}
                  className={cn(expired && 'opacity-40')}
                  leading={
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTokens((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) next.delete(key);
                          else next.add(key);
                          return next;
                        });
                      }}
                      className={cn(
                        'tap grid size-5 place-items-center rounded border transition-all',
                        selected ? 'bg-[#E7D7BE] border-[#F3E6D1]' : 'border-[#3B372F] bg-[#090907]',
                      )}
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={`Select ${link.title || link.token}`}
                    >
                      {selected && <Check size={11} className="text-black" strokeWidth={3} />}
                    </div>
                  }
                  title={
                    <span className="flex items-center gap-2">
                      <span className={cn('truncate', !link.title && 'font-mono text-[#D0C3AF]')}>
                        {link.title || link.token}
                      </span>
                      {isTop && (
                        <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E7D7BE]/15 border border-[#E7D7BE]/30 text-[#E7D7BE]">
                          Top
                        </span>
                      )}
                    </span>
                  }
                  meta={
                    <>
                      {link.kind || 'share'} · {link.track_ids?.length ?? 0} track{(link.track_ids?.length ?? 0) === 1 ? '' : 's'} · {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
                      {expired ? ' · expired' : link.expires_at ? ` · until ${formatDate(link.expires_at)}` : ''}
                    </>
                  }
                  trailing={
                    <>
                      {link.password_protected && <Lock size={11} className="text-[#B4AA99]" aria-label="Password protected" />}
                      {link.allow_downloads !== false && <Download size={11} className="text-[#B4AA99]" aria-label="Downloads enabled" />}
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="tap grid size-7 place-items-center rounded-full text-[#B4AA99] hover:bg-white/[0.04] hover:text-white transition-colors"
                        title="Open share page"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </>
                  }
                />
              );
            })}
          </ListContainer>

          {/* lg+: card grid — title leads, one quiet metadata line, icon flags. */}
          <div className="hidden lg:grid grid-cols-3 gap-3">
            {visibleLinks.map((link, idx) => {
              const expired = isExpired(link);
              const key = linkKey(link);
              const selected = selectedTokens.has(key);
              const maxPlays = Math.max(...visibleLinks.map((l) => l.plays ?? 0), 1);
              const playPct = Math.round(((link.plays ?? 0) / maxPlays) * 100);
              const isTop = idx === 0 && (link.plays ?? 0) > 0;
              return (
                <div
                  key={key}
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
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
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

                  {/* Title row — title dominant; flags + open shortcut quiet right. */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <h3 className={cn('truncate text-row-title', !link.title && 'font-mono text-[#D0C3AF]')}>
                        {link.title || link.token}
                      </h3>
                      {isTop && (
                        <span className="shrink-0 text-[8px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#E7D7BE]/15 border border-[#E7D7BE]/30 text-[#E7D7BE]">
                          Top
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-[#B4AA99]">
                      {link.password_protected && <Lock size={11} aria-label="Password protected" />}
                      {link.allow_downloads !== false && <Download size={11} aria-label="Downloads enabled" />}
                      <a
                        href={link.href}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="grid size-7 place-items-center rounded-full hover:bg-white/[0.04] hover:text-white transition-colors"
                        title="Open share page"
                      >
                        <ExternalLink size={12} />
                      </a>
                    </div>
                  </div>

                  {/* One quiet metadata line. */}
                  <p className="mb-3 truncate text-meta">
                    {link.kind || 'share'} · {link.track_ids?.length ?? 0} track{(link.track_ids?.length ?? 0) === 1 ? '' : 's'} · {link.plays ?? 0} play{(link.plays ?? 0) === 1 ? '' : 's'}
                    {expired ? (
                      <span className="text-red-400"> · expired</span>
                    ) : link.expires_at ? (
                      ` · until ${formatDate(link.expires_at)}`
                    ) : (
                      ' · never expires'
                    )}
                  </p>

                  {/* Engagement bar — thin, low-contrast relative play share. */}
                  <div className="h-0.5 bg-[#211F1A] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#6E685B] transition-all duration-700 group-hover:bg-[#C9BCA8]"
                      style={{ width: `${playPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          </>
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
          copied={copied === linkKey(active)}
          fullUrl={fullUrl(active)}
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
              const keys = Array.from(selectedTokens);
              const selectedLinks = links.filter((link) => selectedTokens.has(linkKey(link)));
              const ok = await confirmToast(
                `Delete ${keys.length} link${keys.length === 1 ? '' : 's'}?`,
                'Recipients with these URLs will get 404. This is permanent.',
                { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
              );
              if (!ok) return;
              setBulkBusy(true);
              const results = await Promise.allSettled(
                selectedLinks.map((link) => {
                  const endpoint =
                    link.source === 'project_shares' ? `/api/shares/${link.id}` : `/api/share/${link.token}`;
                  return fetch(endpoint, { method: 'DELETE' }).then((res) => {
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    return linkKey(link);
                  });
                }),
              );
              const failed = results.filter((r) => r.status === 'rejected').length;
              const deletedKeys = new Set(
                results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
              );
              setBulkBusy(false);
              setSelectedTokens(new Set());
              setLinks((prev) => prev.filter((link) => !deletedKeys.has(linkKey(link))));
              if (active && deletedKeys.has(linkKey(active))) setActive(null);
              if (failed === 0) toast.success(`Deleted ${keys.length} link${keys.length === 1 ? '' : 's'}`);
              else toast.warning(`Deleted ${keys.length - failed}, ${failed} failed`);
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

function LinkMetric({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone?: 'default' | 'good';
}) {
  return (
    <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[#9B9282]">
        {icon}
        <p className="text-[9px] font-mono uppercase tracking-[0.18em]">{label}</p>
      </div>
      <p className={`text-[20px] font-semibold leading-none tabular-nums ${tone === 'good' ? 'text-[#6DC6A4]' : 'text-[#F7EBDD]'}`}>
        {value}
      </p>
    </div>
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
  onCopy: (link: ShareLink) => void;
  onShare: (link: ShareLink) => void;
  onDelete: (link: ShareLink) => void;
  onPatch: (link: ShareLink, patch: Record<string, unknown>) => Promise<boolean>;
  copied: boolean;
  fullUrl: string;
  expired: boolean;
  formatDate: (iso: string) => string;
}) {
  const tracks = link.tracks ?? [];

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
    if (link.source === 'share_links') {
      patch.expires_days = Number(editExpiresDays || 0);
      if (editClearPassword) patch.password = null;
      else if (editPassword) patch.password = editPassword;
    }
    const ok = await onPatch(link, patch);
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
            {link.password_protected && <FlagChip icon={<Lock size={10} />} label="Password" tone="warn" />}
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
            {tracks.length === 0 ? (
              <p className="text-[10px] text-[#6E685B] font-mono">No tracks resolved</p>
            ) : (
              <ul className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                {tracks.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-[11px] text-[#D0C3AF]">
                    <div className="w-6 h-6 rounded bg-[#090907] border border-[#2B2821] overflow-hidden shrink-0">
                      <div className="w-full h-full flex items-center justify-center text-[#6E685B]">
                        <Music size={10} />
                      </div>
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
                {link.source === 'share_links' && <div>
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
                </div>}
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

              {link.source === 'share_links' && <div>
                <label className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-1 flex items-center justify-between">
                  <span>Password {link.password_protected && <span className="text-[#9B9282] normal-case">(currently set)</span>}</span>
                  {link.password_protected && (
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
                  placeholder={link.password_protected ? '••••••' : 'No password'}
                  className="w-full bg-[#090907] border border-[#2B2821] rounded-md px-2.5 py-2 text-[11px] text-[#F7EBDD] placeholder:text-[#6E685B] focus:outline-none focus:border-[#C9BCA8] disabled:opacity-40"
                />
              </div>}

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
              onClick={() => onCopy(link)}
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
              href={link.href}
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
              onClick={() => onDelete(link)}
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
