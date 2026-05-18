'use client';

import { useEffect, useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Megaphone, Plus, Loader2, X, Mail, ChevronRight, TrendingUp } from 'lucide-react';
import { toast } from '@/hooks/useToast';
import Link from 'next/link';

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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

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

  return (
    <DashboardLayout>
      <div className="max-w-[1400px] mx-auto px-4 md:px-10 pt-6 md:pt-10">
        {/* Header */}
        <div className="mb-6 pb-6 border-b border-[#16130e]">
          <div className="relative mb-6 rounded-2xl overflow-hidden border border-white/[0.05] bg-gradient-to-br from-[#14110d]/50 via-[#0a0907]/30 to-[#0a0907] p-8">
            <div className="absolute inset-0 z-0 bg-[url('/images/hero-abstract-3.jpg')] bg-cover bg-center opacity-20 mix-blend-overlay" />
            <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-4">
              <div>
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-2">CAMPAIGNS</p>
                <h1 className="text-[40px] font-bold tracking-tight text-white leading-none font-heading mb-3">
                  Campaigns
                </h1>
                <p className="text-[11px] text-[#a08a6a] max-w-md">
                  Outreach batches. Group your sends, watch them convert.
                </p>
              </div>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-full bg-white text-black hover:bg-[#E8DCC8] text-[11px] font-medium transition-colors active:scale-[0.98]"
              >
                <Plus size={13} />
                New campaign
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <div className="flex items-center justify-center py-32 text-[#6a5d4a]">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-32 border border-dashed border-[#1a160f] rounded-lg">
            <Megaphone size={24} className="text-[#3a3328] mx-auto mb-4" />
            <p className="text-sm text-[#E8DCC8] mb-1">No campaigns yet</p>
            <p className="text-[11px] text-[#5a5142] mb-6">
              Group beat sends into named batches so you can track how each push converts.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-white text-black hover:bg-[#E8DCC8] text-[11px] font-medium"
            >
              <Plus size={13} />
              Create your first campaign
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map((c) => (
              <CampaignCard key={c.id} campaign={c} />
            ))}
          </div>
        )}
      </div>

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

function CampaignCard({ campaign }: { campaign: Campaign }) {
  const { total, placed, pass, pending } = campaign.stats;
  const placementRate = total > 0 ? Math.round((placed / total) * 100) : 0;
  return (
    <Link
      href={`/contacts`}
      className="block group rounded-2xl border border-[#1f1a13] bg-[#14110d] p-5 hover:border-[#2d2620] transition-colors"
      title="Open contacts (campaign drill-down coming soon)"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] mb-1">
            {new Date(campaign.created_at).toLocaleDateString()}
          </p>
          <h3 className="text-[15px] font-medium text-white truncate">{campaign.name}</h3>
          {campaign.description && (
            <p className="text-[12px] text-[#a08a6a] mt-1 line-clamp-2 leading-relaxed">
              {campaign.description}
            </p>
          )}
        </div>
        <ChevronRight size={14} className="text-[#3a3328] shrink-0 group-hover:text-[#E8DCC8] transition-colors mt-1" />
      </div>

      {/* Funnel mini-stats */}
      <div className="grid grid-cols-4 gap-2 pt-4 border-t border-[#1f1a13]">
        <Stat label="Total" value={total} tone="default" />
        <Stat label="Pending" value={pending} tone="default" />
        <Stat label="Placed" value={placed} tone="good" />
        <Stat label="Pass" value={pass} tone="bad" />
      </div>

      {total > 0 && (
        <div className="flex items-center gap-1.5 mt-3 text-[10px] font-mono text-[#6a5d4a]">
          <TrendingUp size={10} />
          {placementRate}% placement rate
        </div>
      )}
      {campaign.nudge_after_days != null && (
        <div className="flex items-center gap-1.5 mt-1.5 text-[10px] font-mono text-[#6a5d4a]">
          <Mail size={10} />
          Nudge after {campaign.nudge_after_days}d
        </div>
      )}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'default' | 'good' | 'bad' }) {
  const color =
    tone === 'good' ? 'text-[#6DC6A4]' : tone === 'bad' ? 'text-[#e88a8a]' : 'text-[#E8DCC8]';
  return (
    <div>
      <p className="text-[9px] font-mono uppercase tracking-[0.15em] text-[#5a5142]">{label}</p>
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md bg-[#16130e] border border-[#1f1a13] rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-[#1f1a13] flex justify-between items-center bg-[#0a0907]">
          <h2 className="text-sm font-black uppercase tracking-[0.2em] text-[#E8DCC8]">New Campaign</h2>
          <button type="button" onClick={onClose} className="text-[#4a4338] hover:text-[#E8DCC8]">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338]">Name</label>
            <input
              required
              autoFocus
              type="text"
              placeholder="MARCH DRILL PUSH"
              className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338]">Description</label>
            <textarea
              rows={3}
              placeholder="What is this batch for? Who is it going to?"
              className="w-full bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors resize-none leading-relaxed"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={5000}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#4a4338]">
              Nudge after (days)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              placeholder="5"
              className="w-32 bg-[#0a0907] border border-[#1f1a13] rounded-xl py-3 px-4 text-xs uppercase tracking-widest text-[#E8DCC8] focus:outline-none focus:border-[#D4BFA0] transition-colors"
              value={nudgeAfterDays}
              onChange={(e) => setNudgeAfterDays(e.target.value)}
            />
            <p className="text-[10px] text-[#5a5142]">
              Contacts in this campaign show up under “Needs nudge” after this many days of silence.
            </p>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-[#1f1a13] flex items-center justify-end gap-2 bg-[#0a0907]">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[#1f1a13] hover:border-[#2d2620] rounded text-[10px] font-bold uppercase tracking-wider text-[#6a5d4a] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="flex items-center gap-2 bg-[#D4BFA0] hover:bg-[#8A7A5C] text-white text-[10px] font-bold uppercase tracking-widest px-5 py-2.5 rounded transition-colors disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={11} />}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
