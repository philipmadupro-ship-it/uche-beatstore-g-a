'use client';

import { useEffect, useMemo, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Megaphone, Plus, Loader2, Mail, ChevronRight, TrendingUp, Search, Users, CheckCircle2 } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import Link from 'next/link';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

/**
 * /campaigns — outreach batches dashboard.
 *
 * Each campaign groups a set of beat_sends so the producer can ask
 * "how did the March drill push convert?" instead of staring at a
 * flat send log. The list view shows per-campaign stats (total
 * targets, placed, pass, pending) and a create modal lets the user
 * spin up a new one.
 *
 * Wiring sends into a campaign happens elsewhere — the SendBeatModal
 * will eventually grow a "Tag this batch as part of…" selector. For
 * now this page is the index: see your campaigns, create new ones,
 * eyeball the funnel.
 */

interface CampaignStats {
  total: number;
  placed: number;
  pass: number;
  pending: number;
}

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  nudge_after_days: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  stats: CampaignStats;
}

const CAMPAIGN_FILTERS = ['All', 'Active', 'Has wins', 'Needs targets'] as const;
type CampaignFilter = (typeof CAMPAIGN_FILTERS)[number];

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CampaignFilter>('All');

  const load = async () => {
    try {
      const res = await fetch('/api/campaigns');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch (err) {
      console.error('Load campaigns failed:', err);
      toast.error('Couldn’t load campaigns', err instanceof Error ? err.message : 'Network error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const campaignSummary = useMemo(() => {
    return campaigns.reduce(
      (acc, c) => {
        acc.targets += c.stats.total;
        acc.placed += c.stats.placed;
        if (c.stats.total === 0) acc.empty += 1;
        if (c.stats.pending > 0) acc.active += 1;
        return acc;
      },
      { targets: 0, placed: 0, empty: 0, active: 0 },
    );
  }, [campaigns]);

  const visibleCampaigns = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (filter === 'Active' && c.stats.pending === 0) return false;
      if (filter === 'Has wins' && c.stats.placed === 0) return false;
      if (filter === 'Needs targets' && c.stats.total > 0) return false;
      if (q && !c.name.toLowerCase().includes(q) && !(c.description ?? '').toLowerCase().includes(q)) return false;
      return true;
    });
  }, [campaigns, filter, search]);

  return (
    <DashboardLayout>
      <PageContainer>
        <PageHeader
          eyebrow="Campaigns"
          title="Campaigns"
          description="Outreach batches. Group your sends, watch them convert."
          meta={`${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`}
          actions={
            <Button
              onClick={() => setShowCreate(true)}
              variant="primary"
              leadingIcon={<Plus size={13} aria-hidden="true" />}
            >
              New campaign
            </Button>
          }
        />

        {!loading && campaigns.length > 0 && (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CampaignMetric label="Campaigns" value={campaigns.length} icon={<Megaphone size={13} />} />
              <CampaignMetric label="Targets" value={campaignSummary.targets} icon={<Users size={13} />} />
              <CampaignMetric label="Placed" value={campaignSummary.placed} icon={<CheckCircle2 size={13} />} tone="good" />
              <CampaignMetric label="Need targets" value={campaignSummary.empty} icon={<Plus size={13} />} tone="warm" />
            </div>

            <div className="mb-5 rounded-2xl border border-[#2B2821] bg-[#11100D] p-2.5">
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search size={12} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#6E685B]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search campaigns…"
                    className="w-full rounded-full border border-[#2B2821] bg-[#090907] py-2 pl-8 pr-3 text-[12px] text-[#F7EBDD] transition-colors placeholder:text-[#6E685B] focus:border-[#C9BCA8] focus:outline-none"
                  />
                </div>
                <div className="flex overflow-x-auto rounded-full border border-[#2B2821] bg-[#090907] p-1">
                  {CAMPAIGN_FILTERS.map((f) => (
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
                  {visibleCampaigns.length} shown
                  {visibleCampaigns.length !== campaigns.length && ` · ${campaigns.length} total`}
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

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-32 text-[#B4AA99]">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon={<Megaphone size={24} aria-hidden="true" />}
            title="No campaigns yet"
            description="Group beat sends into named batches so you can track how each push converts."
            action={
              <Button
                onClick={() => setShowCreate(true)}
                variant="primary"
                leadingIcon={<Plus size={13} aria-hidden="true" />}
              >
                Create campaign
              </Button>
            }
            className="border-dashed py-32"
          />
        ) : visibleCampaigns.length === 0 ? (
          <EmptyState
            icon={<Search size={24} aria-hidden="true" />}
            title="No matching campaigns"
            description="Clear the search or switch filters to see the rest of your outreach batches."
            className="border-dashed py-24"
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleCampaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}
      </PageContainer>

      {showCreate && (
        <CreateCampaignModal
          onClose={() => setShowCreate(false)}
          onCreated={(c) => {
            // Prepend so the new campaign lands at the top of the
            // recency-sorted grid without a full refetch.
            setCampaigns((prev) => [{ ...c, stats: { total: 0, placed: 0, pass: 0, pending: 0 } }, ...prev]);
            setShowCreate(false);
          }}
          busy={creating}
          setBusy={setCreating}
        />
      )}
    </DashboardLayout>
  );
}

function CampaignMetric({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'default' | 'good' | 'warm';
}) {
  const toneClass = tone === 'good' ? 'text-[#6DC6A4]' : tone === 'warm' ? 'text-[#E7D7BE]' : 'text-[#F7EBDD]';
  return (
    <div className="rounded-xl border border-[#2B2821] bg-[#171511] px-4 py-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-[#9B9282]">
        {icon}
        <p className="text-[9px] font-mono uppercase tracking-[0.18em]">{label}</p>
      </div>
      <p className={`text-[20px] font-semibold leading-none tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const { total, placed, pass, pending } = campaign.stats;
  const placementRate = total > 0 ? Math.round((placed / total) * 100) : 0;
  return (
    <Link
      href={`/campaigns/${campaign.id}`}
      className="group block rounded-2xl border border-[#2B2821] bg-[#171511] p-4 transition-colors hover:border-[#3B372F] sm:p-5"
      title={`Open ${campaign.name}`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#B4AA99] mb-1">
            {new Date(campaign.created_at).toLocaleDateString()}
          </p>
          <h3 className="truncate text-[15px] font-semibold text-white">{campaign.name}</h3>
          {campaign.description && (
            <p className="text-[12px] text-[#D0C3AF] mt-1 line-clamp-2 leading-relaxed">
              {campaign.description}
            </p>
          )}
        </div>
        <ChevronRight size={14} className="text-[#6E685B] shrink-0 group-hover:text-[#F7EBDD] transition-colors mt-1" />
      </div>

      {/* Funnel mini-stats */}
      <div className="grid grid-cols-4 gap-2 rounded-xl border border-[#211F1A] bg-[#11100D] p-2">
        <Stat label="Total" value={total} tone="default" />
        <Stat label="Pending" value={pending} tone="default" />
        <Stat label="Placed" value={placed} tone="good" />
        <Stat label="Pass" value={pass} tone="bad" />
      </div>

      {total > 0 && (
        <div className="flex items-center gap-1.5 mt-3 text-[10px] font-mono text-[#B4AA99]">
          <TrendingUp size={10} />
          {placementRate}% placement rate
        </div>
      )}
      {campaign.nudge_after_days != null && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-[#B4AA99]">
          <Mail size={10} />
          Nudge after {campaign.nudge_after_days}d
        </div>
      )}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'default' | 'good' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-[#6DC6A4]' : tone === 'bad' ? 'text-[#e88a8a]' : 'text-[#F7EBDD]';
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-[#9B9282]">{label}</p>
      <p className={`text-[18px] font-medium tabular-nums leading-tight mt-0.5 ${color}`}>{value}</p>
    </div>
  );
}

function CreateCampaignModal({
  onClose,
  onCreated,
  busy,
  setBusy,
}: {
  onClose: () => void;
  onCreated: (c: Campaign) => void;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nudgeAfterDays, setNudgeAfterDays] = useState<string>('5');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          nudge_after_days: nudgeAfterDays ? Number(nudgeAfterDays) : null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      const { campaign } = await res.json();
      toast.success('Campaign created');
      onCreated(campaign);
    } catch (err) {
      console.error(err);
      toast.error('Couldn’t create campaign', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title="New campaign"
      description="Name the outreach batch and set when silent contacts should surface for a nudge."
      icon={<Megaphone size={18} aria-hidden="true" />}
      size="md"
      contentClassName="p-0"
    >
      <form
        onSubmit={handleSubmit}
        className="space-y-4 p-5 sm:p-6"
      >
        <Field
          required
          autoFocus
          type="text"
          label="Name"
          placeholder="MARCH DRILL PUSH"
          inputClassName="uppercase tracking-widest"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
        />

        <Field
          multiline
          rows={3}
          label="Description"
          placeholder="What is this batch for? Who is it going to?"
          inputClassName="leading-relaxed"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={5000}
        />

        <Field
          type="number"
          min={1}
          max={60}
          label="Nudge after (days)"
          helperText="Contacts in this campaign show up under Needs nudge after this many days of silence."
          placeholder="5"
          className="max-w-48"
          inputClassName="uppercase tracking-widest"
          value={nudgeAfterDays}
          onChange={(e) => setNudgeAfterDays(e.target.value)}
        />

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            onClick={onClose}
            variant="secondary"
            size="sm"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || busy}
            loading={busy}
            variant="accent"
            size="sm"
            leadingIcon={<Plus size={11} aria-hidden="true" />}
          >
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
