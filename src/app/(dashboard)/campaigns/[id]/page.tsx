'use client';

/**
 * /campaigns/[id] — campaign drill-down.
 *
 * The campaign index shows the funnel numbers; this page shows the people
 * behind them. Targets (contacts attached to the campaign) render as list
 * rows with their pipeline status, send count, and last-send date. From
 * here the producer can add contacts, remove them, and launch a beat send
 * pre-addressed to everyone in the campaign.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Modal } from '@/components/ui/Modal';
import { ListContainer, ListRow } from '@/components/ui/ListRow';
import { SendBeatModal } from '@/components/crm/SendBeatModal';
import { toast, confirmToast } from '@/hooks/useToast';
import {
  ArrowLeft, Loader2, Megaphone, Plus, Search, Send, Trash2,
  Users, Mail, TrendingUp, Check, X,
} from 'lucide-react';
import type { Contact } from '@/lib/types';

interface CampaignDetail {
  id: string;
  name: string;
  description: string | null;
  nudge_after_days: number | null;
  created_at: string;
}

interface Target {
  id: string;
  contact_id: string;
  status: 'sent' | 'opened' | 'interested' | 'negotiating' | 'placed' | 'pass';
  last_nudge_at: string | null;
  nudge_count: number;
  created_at: string;
  contact: { id: string; name: string; email: string | null; role: string | null } | null;
  sends_count: number;
  last_sent_at: string | null;
}

const STATUS_STYLES: Record<Target['status'], string> = {
  sent: 'text-white/80 bg-white/[0.04] border-white/[0.08]',
  opened: 'text-black bg-white font-semibold shadow-md hover:bg-white/90 border-white/20',
  interested: 'text-[#c8a47a] bg-[#c8a47a]/10 border-[#c8a47a]/25',
  negotiating: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  placed: 'text-[#6DC6A4] bg-[#6DC6A4]/10 border-[#6DC6A4]/20',
  pass: 'text-[#e88a8a] bg-red-500/10 border-red-500/20',
};

const TARGET_FILTERS = ['All', 'Sent', 'Opened', 'Interested', 'Negotiating', 'Placed', 'Pass'] as const;
type TargetFilter = (typeof TARGET_FILTERS)[number];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function CampaignDetailPage({ params: paramsPromise }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(paramsPromise);
  const router = useRouter();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [targetSearch, setTargetSearch] = useState('');
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('All');

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setCampaign(data.campaign ?? null);
      setTargets(data.targets ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const funnel = useMemo(() => {
    const placed = targets.filter((t) => t.status === 'placed').length;
    const pass = targets.filter((t) => t.status === 'pass').length;
    return {
      total: targets.length,
      placed,
      pass,
      pending: targets.length - placed - pass,
      rate: targets.length > 0 ? Math.round((placed / targets.length) * 100) : 0,
    };
  }, [targets]);

  // Contacts already in the campaign, as Contact objects for SendBeatModal.
  const targetContacts = useMemo(
    () => targets
      .map((t) => t.contact)
      .filter((c): c is NonNullable<Target['contact']> => !!c && !!c.email)
      .map((c) => ({ id: c.id, name: c.name, email: c.email }) as Contact),
    [targets],
  );

  const visibleTargets = useMemo(() => {
    const q = targetSearch.trim().toLowerCase();
    return targets.filter((t) => {
      if (targetFilter !== 'All' && t.status !== targetFilter.toLowerCase()) return false;
      if (q) {
        const contact = t.contact;
        if (
          !(contact?.name ?? '').toLowerCase().includes(q) &&
          !(contact?.email ?? '').toLowerCase().includes(q) &&
          !(contact?.role ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [targets, targetFilter, targetSearch]);

  const removeTarget = async (target: Target) => {
    const name = target.contact?.name ?? 'this contact';
    const ok = await confirmToast(
      `Remove ${name} from the campaign?`,
      'Their send history stays; they just leave this batch.',
      { confirmLabel: 'Remove', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    setRemoving(target.contact_id);
    try {
      const res = await fetch(`/api/campaigns/${id}/targets`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: target.contact_id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      setTargets((prev) => prev.filter((t) => t.contact_id !== target.contact_id));
      toast.success(`Removed ${name}`);
    } catch (err) {
      toast.error("Couldn't remove contact", err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRemoving(null);
    }
  };

  const deleteCampaign = async () => {
    if (!campaign) return;
    const ok = await confirmToast(
      `Delete "${campaign.name}"?`,
      'Send history stays on the contacts; only the campaign grouping is removed.',
      { confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true },
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      toast.success('Campaign deleted');
      router.push('/campaigns');
    } catch (err) {
      toast.error("Couldn't delete campaign", err instanceof Error ? err.message : 'Unknown error');
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-40">
          <Loader2 size={18} className="animate-spin text-white/40" />
        </div>
      </DashboardLayout>
    );
  }

  if (error || !campaign) {
    return (
      <DashboardLayout>
        <PageContainer>
          <EmptyState
            icon={<Megaphone size={24} aria-hidden="true" />}
            title="Campaign unavailable"
            description={error ?? 'Not found.'}
            action={
              <Link href="/campaigns" className="text-[12px] text-white/60 underline underline-offset-2 hover:text-white">
                Back to campaigns
              </Link>
            }
            className="py-32"
          />
        </PageContainer>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <PageContainer className="max-w-[1100px] pb-32">
        <Link
          href="/campaigns"
          className="mb-4 inline-flex items-center gap-1.5 text-micro text-white/50 transition-colors hover:text-white"
        >
          <ArrowLeft size={11} />
          Campaigns
        </Link>

        <PageHeader
          eyebrow={`Campaign · ${new Date(campaign.created_at).toLocaleDateString()}`}
          title={campaign.name}
          description={campaign.description ?? undefined}
          meta={campaign.nudge_after_days != null ? `Nudge after ${campaign.nudge_after_days}d of silence` : undefined}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => setSendOpen(true)}
                variant="primary"
                size="sm"
                disabled={targetContacts.length === 0}
                leadingIcon={<Send size={12} aria-hidden="true" />}
                title={targetContacts.length === 0 ? 'Add contacts with emails first' : `Send a beat to all ${targetContacts.length} contacts`}
              >
                Send beats
              </Button>
              <Button
                onClick={() => setAddOpen(true)}
                variant="secondary"
                size="sm"
                leadingIcon={<Plus size={12} aria-hidden="true" />}
              >
                Add contacts
              </Button>
              <Button
                onClick={deleteCampaign}
                variant="ghost"
                size="sm"
                iconOnly
                aria-label="Delete campaign"
                title="Delete campaign"
              >
                <Trash2 size={13} aria-hidden="true" />
              </Button>
            </div>
          }
        />

        {/* Funnel strip */}
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-5">
          <FunnelStat label="Targets" value={funnel.total} />
          <FunnelStat label="Pending" value={funnel.pending} />
          <FunnelStat label="Placed" value={funnel.placed} tone="good" />
          <FunnelStat label="Pass" value={funnel.pass} tone="bad" />
          <div className="col-span-2 flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 sm:col-span-1">
            <TrendingUp size={13} className="text-white" />
            <div>
              <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/50">Placement</p>
              <p className="text-[18px] font-medium tabular-nums leading-tight text-white">{funnel.rate}%</p>
            </div>
          </div>
        </div>

        {/* Targets */}
        {targets.length === 0 ? (
          <EmptyState
            icon={<Users size={24} aria-hidden="true" />}
            title="No contacts in this campaign yet"
            description="Add contacts, then send them beats — their funnel status shows up here."
            action={
              <Button onClick={() => setAddOpen(true)} variant="secondary" leadingIcon={<Plus size={12} aria-hidden="true" />}>
                Add contacts
              </Button>
            }
            className="border-dashed py-24"
          />
        ) : (
          <section className="space-y-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-2.5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
                  <input
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                    placeholder="Search contacts in this campaign…"
                    className="w-full rounded-full border border-white/10 bg-[#090907] py-2 pl-8 pr-3 text-[12px] text-white transition-colors placeholder:text-white/40 focus:border-white/60 focus:outline-none"
                  />
                </div>
                <div className="flex overflow-x-auto rounded-full border border-white/10 bg-[#090907] p-1">
                  {TARGET_FILTERS.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setTargetFilter(f)}
                      className={`shrink-0 rounded-full px-3 py-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                        targetFilter === f ? 'bg-white/15 text-white font-bold' : 'text-white/60 hover:text-white'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between px-1">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/40">
                  {visibleTargets.length} shown
                  {visibleTargets.length !== targets.length && ` · ${targets.length} total`}
                </p>
                {(targetSearch.trim() || targetFilter !== 'All') && (
                  <button
                    type="button"
                    onClick={() => { setTargetSearch(''); setTargetFilter('All'); }}
                    className="text-[10px] font-mono uppercase tracking-[0.16em] text-white/60 transition-colors hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {visibleTargets.length === 0 ? (
              <EmptyState
                icon={<Search size={24} aria-hidden="true" />}
                title="No matching contacts"
                description="Clear the search or switch status filters to see everyone in this campaign."
                className="border-dashed py-20"
              />
            ) : (
              <ListContainer
                header={
                  <span className="text-eyebrow">{visibleTargets.length} contact{visibleTargets.length === 1 ? '' : 's'}</span>
                }
              >
                {visibleTargets.map((t) => (
                  <ListRow
                    key={t.id}
                    href={t.contact ? `/contacts/${t.contact.id}` : undefined}
                    label={t.contact ? `Open ${t.contact.name}` : undefined}
                    media={
                      <div className="grid size-9 place-items-center rounded-full bg-white/15 text-[12px] font-bold text-white">
                        {(t.contact?.name ?? '?').charAt(0).toUpperCase()}
                      </div>
                    }
                    title={t.contact?.name ?? 'Deleted contact'}
                    meta={
                      <>
                        {t.contact?.email ?? 'no email'}
                        {t.sends_count > 0 && (
                          <> · {t.sends_count} send{t.sends_count === 1 ? '' : 's'} · last {fmtDate(t.last_sent_at)}</>
                        )}
                      </>
                    }
                    columns={
                      t.nudge_count > 0 ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono text-white/50">
                          <Mail size={10} /> {t.nudge_count} nudge{t.nudge_count === 1 ? '' : 's'}
                        </span>
                      ) : undefined
                    }
                    trailing={
                      <>
                        <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[8px] font-mono uppercase tracking-wider ${STATUS_STYLES[t.status]}`}>
                          {t.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTarget(t)}
                          disabled={removing === t.contact_id}
                          className="tap grid size-7 place-items-center rounded-full text-white/40 transition-colors hover:bg-white/[0.04] hover:text-red-400 disabled:opacity-40"
                          title="Remove from campaign"
                          aria-label={`Remove ${t.contact?.name ?? 'contact'} from campaign`}
                        >
                          {removing === t.contact_id ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                        </button>
                      </>
                    }
                  />
                ))}
              </ListContainer>
            )}
          </section>
        )}
      </PageContainer>

      {addOpen && (
        <AddContactsModal
          campaignId={id}
          existingContactIds={new Set(targets.map((t) => t.contact_id))}
          onClose={() => setAddOpen(false)}
          onAdded={() => { setAddOpen(false); load(); }}
        />
      )}

      {sendOpen && (
        <SendBeatModal
          contacts={targetContacts}
          campaignId={id}
          onClose={() => setSendOpen(false)}
          onSuccess={() => { setSendOpen(false); load(); }}
        />
      )}
    </DashboardLayout>
  );
}

function FunnelStat({ label, value, tone = 'default' }: { label: string; value: number; tone?: 'default' | 'good' | 'bad' }) {
  const color = tone === 'good' ? 'text-[#6DC6A4]' : tone === 'bad' ? 'text-[#e88a8a]' : 'text-white/80';
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3">
      <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-white/50">{label}</p>
      <p className={`text-[18px] font-medium tabular-nums leading-tight ${color}`}>{value}</p>
    </div>
  );
}

/** Contact picker — search the CRM, multi-select, attach to the campaign. */
function AddContactsModal({
  campaignId, existingContactIds, onClose, onAdded,
}: {
  campaignId: string;
  existingContactIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; email: string | null; role: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/contacts');
        const data = await res.json();
        setContacts(Array.isArray(data) ? data : data.contacts ?? []);
      } catch {
        toast.error("Couldn't load contacts");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return contacts
      .filter((c) => !existingContactIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (c.email ?? '').toLowerCase().includes(q));
  }, [contacts, search, existingContactIds]);

  const toggle = (cid: string) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(cid)) n.delete(cid); else n.add(cid);
    return n;
  });

  const handleAdd = async () => {
    if (selected.size === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/targets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: Array.from(selected) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success(`Added ${selected.size} contact${selected.size === 1 ? '' : 's'}`);
      onAdded();
    } catch (err) {
      toast.error("Couldn't add contacts", err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="Add contacts"
      description="Pick who belongs in this campaign batch."
      icon={<Users size={18} aria-hidden="true" />}
      size="md"
    >
      <div className="space-y-3">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            autoFocus
            className="w-full rounded-full border border-white/10 bg-white/[0.02] py-2 pl-9 pr-3 text-[12px] text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={15} className="animate-spin text-white/40" />
          </div>
        ) : visible.length === 0 ? (
          <p className="py-10 text-center text-[11px] text-white/50">
            {contacts.length === 0 ? 'No contacts in your CRM yet.' : 'No matches (already-added contacts are hidden).'}
          </p>
        ) : (
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {visible.map((c) => {
              const sel = selected.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    sel ? 'border-white/50 bg-white/15 font-bold' : 'border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <div className={`grid size-5 shrink-0 place-items-center rounded border ${sel ? 'border-white bg-white' : 'border-white/20'}`}>
                    {sel && <Check size={11} className="text-black" strokeWidth={3} />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-medium text-white">{c.name}</p>
                    <p className="truncate text-[10px] text-white/50">{c.email ?? 'no email'}</p>
                  </div>
                  {c.role && <span className="shrink-0 text-[9px] font-mono uppercase tracking-wider text-white/40">{c.role}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-3">
          <Button type="button" onClick={onClose} variant="secondary" size="sm">Cancel</Button>
          <Button
            type="button"
            onClick={handleAdd}
            disabled={selected.size === 0}
            loading={saving}
            variant="accent"
            size="sm"
            leadingIcon={<Plus size={11} aria-hidden="true" />}
          >
            Add {selected.size > 0 ? selected.size : ''}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
