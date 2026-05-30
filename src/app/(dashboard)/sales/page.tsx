'use client';

/**
 * /sales — Producer sales feed.
 *
 * Merges per-track `license_purchases` with project-bundle
 * `project_access_links` into one chronological list. The dashboard
 * surface where producers can actually see their incoming purchases.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import {
  Loader2, Receipt, Music, Layers, ExternalLink, Search,
  DollarSign, ShoppingBag, AlertCircle, Send, TrendingUp,
  ArrowUpRight, Tag, Crown, Download, Check, X,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';
import { SkeletonList } from '@/components/ui/Skeleton';

interface Sale {
  id: string;
  kind: 'track' | 'project';
  buyer_email: string;
  item_label: string;
  item_count: number;
  license_type: 'lease' | 'exclusive' | null;
  amount_usd: number | null;
  stripe_session_id: string | null;
  status: 'paid' | 'refunded' | 'disputed' | 'failed' | 'expired';
  download_unlocked: boolean | null;
  needs_stems_upload?: boolean;
  created_at: string;
}

interface Totals {
  count: number;
  revenue_usd: number;
  track_count: number;
  project_count: number;
}

const FILTERS = ['All', 'Tracks', 'Projects'] as const;
type Filter = (typeof FILTERS)[number];

interface Offer {
  id: string;
  track_id: string;
  track_title: string | null;
  buyer_email: string;
  offered_price_usd: number;
  message: string | null;
  status: 'pending' | 'accepted' | 'countered' | 'declined';
  created_at: string;
}

const OFFER_STATUS_STYLES: Record<Offer['status'], string> = {
  pending: 'text-[#D4BFA0] bg-[#D4BFA0]/10 border-[#D4BFA0]/20',
  accepted: 'text-[#6DC6A4] bg-[#6DC6A4]/10 border-[#6DC6A4]/20',
  countered: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  declined: 'text-[#a08a6a] bg-white/[0.04] border-white/[0.06]',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMoney(n: number | null): string {
  if (n == null) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

const STATUS_STYLES: Record<Sale['status'], string> = {
  paid: 'text-[#6DC6A4] bg-[#6DC6A4]/10 border-[#6DC6A4]/20',
  refunded: 'text-[#a08a6a] bg-white/[0.04] border-white/[0.06]',
  disputed: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  failed: 'text-red-400 bg-red-500/10 border-red-500/20',
  expired: 'text-[#a08a6a] bg-white/[0.04] border-white/[0.06]',
};

export default function SalesPage() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('All');
  const [search, setSearch] = useState('');
  // Top-level view: completed sales vs. incoming offers.
  const [view, setView] = useState<'sales' | 'offers'>('sales');
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/sales');
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const data = await res.json();
        setSales(data.sales ?? []);
        setTotals(data.totals ?? null);
      } catch (err: any) {
        setError(err.message || 'Failed to load sales');
      } finally {
        setLoading(false);
      }
    })();
    // Offers load independently (separate entity) so the sales view never blocks on them.
    fetch('/api/store/offer').then(r => r.ok ? r.json() : null).then(d => { if (d?.offers) setOffers(d.offers); }).catch(() => undefined);
  }, []);

  const pendingOffers = useMemo(() => offers.filter((o) => o.status === 'pending').length, [offers]);
  const updateOfferStatus = (id: string, status: Offer['status']) =>
    setOffers((prev) => prev.map((o) => (o.id === id ? { ...o, status } : o)));

  const visibleSales = useMemo(() => {
    return sales.filter((s) => {
      if (filter === 'Tracks' && s.kind !== 'track') return false;
      if (filter === 'Projects' && s.kind !== 'project') return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !s.buyer_email.toLowerCase().includes(q) &&
          !s.item_label.toLowerCase().includes(q) &&
          !(s.stripe_session_id ?? '').toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [sales, filter, search]);

  // ── Derived KPIs ───────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = Date.now();
    const ms7  =  7 * 24 * 60 * 60 * 1000;
    const ms30 = 30 * 24 * 60 * 60 * 1000;
    const ms90 = 90 * 24 * 60 * 60 * 1000;
    const paid = sales.filter((s) => s.status === 'paid');
    const rev7  = paid.filter((s) => now - new Date(s.created_at).getTime() < ms7 ).reduce((a, s) => a + (s.amount_usd ?? 0), 0);
    const rev30 = paid.filter((s) => now - new Date(s.created_at).getTime() < ms30).reduce((a, s) => a + (s.amount_usd ?? 0), 0);
    const rev90 = paid.filter((s) => now - new Date(s.created_at).getTime() < ms90).reduce((a, s) => a + (s.amount_usd ?? 0), 0);
    const leases     = paid.filter((s) => s.license_type === 'lease').length;
    const exclusives = paid.filter((s) => s.license_type === 'exclusive').length;
    const avgSale    = paid.length > 0 ? paid.reduce((a, s) => a + (s.amount_usd ?? 0), 0) / paid.length : 0;
    // Top selling track by revenue
    const trackRevMap: Record<string, { label: string; rev: number; count: number }> = {};
    for (const s of paid) {
      if (s.item_label) {
        const k = s.item_label;
        trackRevMap[k] = { label: k, rev: (trackRevMap[k]?.rev ?? 0) + (s.amount_usd ?? 0), count: (trackRevMap[k]?.count ?? 0) + 1 };
      }
    }
    const topTrack = Object.values(trackRevMap).sort((a, b) => b.rev - a.rev)[0] ?? null;
    return { rev7, rev30, rev90, leases, exclusives, avgSale, topTrack };
  }, [sales]);

  // ── Revenue sparkline (last 30 days by day) ────────────────────
  const sparkline = useMemo(() => {
    const paid = sales.filter((s) => s.status === 'paid');
    const map: Record<string, number> = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      map[d.toISOString().slice(0, 10)] = 0;
    }
    for (const s of paid) {
      const d = new Date(s.created_at).toISOString().slice(0, 10);
      if (d in map) map[d] = (map[d] ?? 0) + (s.amount_usd ?? 0);
    }
    const vals = Object.values(map);
    const max = Math.max(1, ...vals);
    const w = 400; const h = 52;
    const step = w / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
    return { pts, vals, max };
  }, [sales]);

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-start justify-between mb-6 gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">Dashboard</p>
            <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">Sales</h1>
            <p className="text-[12px] text-[#6a5d4a] mt-1.5">Revenue, orders, and license breakdown.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const rows = [
                  ['Date', 'Type', 'Item', 'Buyer', 'Amount (USD)', 'License', 'Status'],
                  ...visibleSales.map((s) => [
                    new Date(s.created_at).toISOString().slice(0, 10),
                    s.kind,
                    s.item_label,
                    s.buyer_email,
                    s.amount_usd != null ? s.amount_usd.toFixed(2) : '',
                    s.license_type ?? '',
                    s.status,
                  ]),
                ];
                const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
                const blob = new Blob([csv], { type: 'text/csv' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = `sales-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                setTimeout(() => URL.revokeObjectURL(a.href), 5000);
              }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-all"
              title="Export visible sales as CSV"
            >
              <Download size={11} />
              Export CSV
            </button>
            <Link href="/analytics" className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-full border border-[#1f1a13] bg-[#14110d] text-[10px] font-mono text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620] transition-all">
              Plays & engagement →
            </Link>
          </div>
        </div>

        {/* ── KPI strip — 4 cols on small, 8 on large ─────────────── */}
        {totals && (
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-2 mb-4">
            <KpiCard label="All time" value={fmtMoney(totals.revenue_usd)} icon={<DollarSign size={13} />} accent="#6DC6A4" />
            <KpiCard label="Last 90d" value={fmtMoney(kpis.rev90)} icon={<TrendingUp size={13} />} accent="#D4BFA0" />
            <KpiCard label="Last 30d" value={fmtMoney(kpis.rev30)} icon={<TrendingUp size={13} />} accent="#D4BFA0" />
            <KpiCard label="Last 7d" value={fmtMoney(kpis.rev7)} icon={<ArrowUpRight size={13} />} accent="#c8a84b" />
            <KpiCard label="Orders" value={String(totals.count)} icon={<ShoppingBag size={13} />} accent="#a08a6a" />
            <KpiCard label="Avg sale" value={totals.count > 0 ? fmtMoney(kpis.avgSale) : '—'} icon={<Tag size={13} />} accent="#9d95e8" />
            <KpiCard label="Leases" value={String(kpis.leases)} icon={<Tag size={13} />} accent="#9d95e8" />
            <KpiCard label="Exclusives" value={String(kpis.exclusives)} icon={<Crown size={13} />} accent="#e8a06a" />
          </div>
        )}

        {/* ── Sparkline + top track ────────────────────────────────── */}
        {sales.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-5">
            {/* Revenue chart */}
            <div className="sm:col-span-2 rounded-2xl border border-[#1f1a13] bg-[#14110d] px-5 py-4">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">Revenue · last 30 days</p>
              <svg viewBox={`0 0 400 52`} className="w-full" preserveAspectRatio="none" style={{ height: 52 }}>
                <defs>
                  <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6DC6A4" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#6DC6A4" stopOpacity="0" />
                  </linearGradient>
                </defs>
                {/* Fill area */}
                <polyline
                  points={`0,52 ${sparkline.pts} 400,52`}
                  fill="url(#sparkGrad)"
                  stroke="none"
                />
                {/* Line */}
                <polyline
                  points={sparkline.pts}
                  fill="none"
                  stroke="#6DC6A4"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              </svg>
              <p className="text-[9px] font-mono text-[#3a3328] mt-2">
                {sparkline.vals.filter(Boolean).length} days with sales
              </p>
            </div>
            {/* Top track */}
            <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-5 py-4 flex flex-col justify-between">
              <p className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142] mb-3">Top seller</p>
              {kpis.topTrack ? (
                <>
                  <div className="flex items-center gap-2 mt-1">
                    <Crown size={16} className="text-[#c8a84b] shrink-0" />
                    <p className="text-[13px] font-semibold text-[#E8DCC8] truncate leading-snug">{kpis.topTrack.label}</p>
                  </div>
                  <p className="text-[20px] font-bold text-white tabular-nums mt-2">{fmtMoney(kpis.topTrack.rev)}</p>
                  <p className="text-[9px] font-mono text-[#5a5142]">from track licenses</p>
                </>
              ) : (
                <p className="text-[12px] text-[#5a5142]">No track sales yet</p>
              )}
            </div>
          </div>
        )}

        {/* View switch — Sales vs. Offers */}
        <div className="flex items-center gap-2 mb-4">
          <button
            type="button"
            onClick={() => setView('sales')}
            className={`px-4 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors ${
              view === 'sales' ? 'bg-white text-black border-white' : 'bg-[#14110d] border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'
            }`}
          >Sales</button>
          <button
            type="button"
            onClick={() => setView('offers')}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors ${
              view === 'offers' ? 'bg-white text-black border-white' : 'bg-[#14110d] border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'
            }`}
          >
            Offers
            {pendingOffers > 0 && (
              <span className={`w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center leading-none ${view === 'offers' ? 'bg-black text-white' : 'bg-[#D4BFA0] text-black'}`}>{pendingOffers}</span>
            )}
          </button>
        </div>

        {view === 'sales' && (
        <>
        {/* Filters */}
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-[10px] font-mono uppercase tracking-wider border transition-colors ${
                filter === f
                  ? 'bg-[#2A2418] border-[#8A7A5C]/40 text-[#E8D8B8]'
                  : 'bg-[#14110d] border-[#1f1a13] text-[#6a5d4a] hover:text-[#E8DCC8] hover:border-[#2d2620]'
              }`}
            >
              {f}
            </button>
          ))}
          <div className="relative ml-auto w-full sm:w-64">
            <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#3a3328]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search buyer, item, session…"
              className="w-full bg-[#14110d] border border-[#1f1a13] rounded-full pl-8 pr-3 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#8A7A5C] transition-colors"
            />
          </div>
        </div>

        {/* Body */}
        {loading ? (
          <SkeletonList rows={8} />
        ) : error ? (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/5 px-5 py-6 flex items-start gap-3">
            <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-[12px] text-red-300 font-medium">Could not load sales</p>
              <p className="text-[10px] text-[#a08a6a] mt-1 font-mono">{error}</p>
            </div>
          </div>
        ) : visibleSales.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#1f1a13] bg-[#14110d]/40 py-16 px-6 text-center">
            <Receipt size={28} className="text-[#3a3328] mx-auto mb-3" />
            <p className="text-[13px] text-[#a08a6a] font-medium">
              {sales.length === 0 ? 'No sales yet.' : 'No sales match your filters.'}
            </p>
            <p className="text-[11px] text-[#5a5142] mt-1">
              {sales.length === 0
                ? 'Once a buyer completes checkout this is where they show up.'
                : 'Try clearing the search or switching filters.'}
            </p>
            {sales.length === 0 && (
              <Link
                href="/store-editor"
                className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-[#D4BFA0] hover:bg-[#E8D8B8] text-black text-[10px] font-bold uppercase tracking-wider transition-colors"
              >
                Open store editor
                <ExternalLink size={11} />
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] overflow-hidden">
            {/* Header row (desktop only) */}
            <div className="hidden md:grid grid-cols-[110px_80px_1fr_1.2fr_90px_100px_24px] gap-3 px-5 py-3 border-b border-[#1a160f] text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">
              <span>Date</span>
              <span>Type</span>
              <span>Item</span>
              <span>Buyer</span>
              <span className="text-right">Amount</span>
              <span>Status</span>
              <span />
            </div>
            <div className="divide-y divide-[#1a160f]">
              {visibleSales.map((s) => (
                <SaleRow key={`${s.kind}:${s.id}`} sale={s} />
              ))}
            </div>
          </div>
        )}
        </>
        )}

        {view === 'offers' && (
          offers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#1f1a13] bg-[#14110d]/40 py-16 px-6 text-center">
              <Tag size={28} className="text-[#3a3328] mx-auto mb-3" />
              <p className="text-[13px] text-[#a08a6a] font-medium">No offers yet.</p>
              <p className="text-[11px] text-[#5a5142] mt-1">When a buyer makes an offer on an exclusive beat, it shows up here to accept, counter, or decline.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {offers.map((o) => (
                <OfferRow key={o.id} offer={o} onStatusChange={updateOfferStatus} />
              ))}
            </div>
          )
        )}
      </div>
    </DashboardLayout>
  );
}

function OfferRow({ offer, onStatusChange }: { offer: Offer; onStatusChange: (id: string, status: Offer['status']) => void }) {
  const [busy, setBusy] = useState<null | 'accept' | 'decline' | 'counter'>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [counterPrice, setCounterPrice] = useState('');

  const respond = async (action: 'accept' | 'decline' | 'counter') => {
    if (busy) return;
    if (action === 'counter') {
      const price = Number.parseFloat(counterPrice);
      if (!Number.isFinite(price) || price <= 0) { toast.error('Enter a counter price'); return; }
    }
    setBusy(action);
    try {
      const res = await fetch(`/api/store/offer/${offer.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(action === 'counter' ? { counter_price_usd: Number.parseFloat(counterPrice) } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      onStatusChange(offer.id, data.status);
      setCounterOpen(false);
      toast.success(
        action === 'accept' ? 'Offer accepted — buyer notified' :
        action === 'counter' ? 'Counter sent to buyer' : 'Offer declined',
      );
    } catch (err: any) {
      toast.error('Could not respond', err.message);
    } finally {
      setBusy(null);
    }
  };

  const isPending = offer.status === 'pending';

  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-4 sm:px-5 py-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Tag size={12} className="text-[#D4BFA0] shrink-0" />
            <p className="text-[13px] font-semibold text-[#E8DCC8] truncate">{offer.track_title || 'Untitled'}</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border shrink-0 ${OFFER_STATUS_STYLES[offer.status]}`}>{offer.status}</span>
          </div>
          <p className="text-[11px] text-[#a08a6a] truncate" title={offer.buyer_email}>{offer.buyer_email} · {fmtDate(offer.created_at)}</p>
          {offer.message && <p className="text-[11px] text-[#6a5d4a] mt-1.5 italic">“{offer.message}”</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">Offer</p>
          <p className="text-[22px] font-bold text-white tabular-nums leading-none">{fmtMoney(offer.offered_price_usd)}</p>
        </div>
      </div>

      {isPending && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1a160f] flex-wrap">
          <button onClick={() => respond('accept')} disabled={!!busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#6DC6A4]/15 border border-[#6DC6A4]/30 text-[#6DC6A4] hover:bg-[#6DC6A4]/25 transition-colors disabled:opacity-40">
            {busy === 'accept' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}Accept
          </button>
          {!counterOpen ? (
            <button onClick={() => setCounterOpen(true)} disabled={!!busy}
              className="px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-wider border border-[#2d2620] text-[#a08a6a] hover:text-[#E8DCC8] hover:border-[#3a3328] transition-colors disabled:opacity-40">
              Counter
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6a5d4a] text-[12px]">$</span>
                <input type="number" min="1" value={counterPrice} onChange={(e) => setCounterPrice(e.target.value)} placeholder="price" autoFocus
                  className="w-24 bg-[#0a0907] border border-[#1f1a13] rounded-full pl-6 pr-2 py-1.5 text-[11px] text-[#E8DCC8] placeholder:text-[#3a3328] focus:outline-none focus:border-[#2d2620] tabular-nums" />
              </div>
              <button onClick={() => respond('counter')} disabled={!!busy}
                className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] transition-colors disabled:opacity-40">
                {busy === 'counter' ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}Send
              </button>
              <button onClick={() => { setCounterOpen(false); setCounterPrice(''); }} className="text-[#5a5142] hover:text-[#E8DCC8]"><X size={13} /></button>
            </div>
          )}
          <button onClick={() => respond('decline')} disabled={!!busy}
            className="ml-auto px-3 py-1.5 rounded-full text-[10px] font-medium uppercase tracking-wider border border-[#1f1a13] text-[#5a5142] hover:text-red-300 hover:border-red-900/40 transition-colors disabled:opacity-40">
            {busy === 'decline' ? <Loader2 size={11} className="animate-spin" /> : 'Decline'}
          </button>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, icon, accent = '#a08a6a' }: { label: string; value: string; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
      <div className="flex items-center gap-1.5 mb-1.5" style={{ color: accent }}>
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-[#5a5142]">{label}</span>
      </div>
      <p className="text-[20px] font-bold text-white tabular-nums leading-none">{value}</p>
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const Icon = sale.kind === 'project' ? Layers : Music;
  const stripeUrl = sale.stripe_session_id
    ? `https://dashboard.stripe.com/payments/${sale.stripe_session_id}`
    : null;
  const [resending, setResending] = useState(false);
  const [delivering, setDelivering] = useState(false);
  const [delivered, setDelivered] = useState(false);

  const handleDeliverStems = async () => {
    if (delivering) return;
    setDelivering(true);
    try {
      const res = await fetch('/api/sales/deliver-stems', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purchase_id: sale.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDelivered(true);
      toast.success('Stems delivered', `${sale.buyer_email} was emailed the download link.`);
    } catch (err: any) {
      toast.error('Could not deliver', err.message);
    } finally {
      setDelivering(false);
    }
  };
  const handleResend = async () => {
    if (resending) return;
    setResending(true);
    try {
      const res = await fetch('/api/sales/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: sale.id, kind: sale.kind }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      toast.success('Delivery email resent', `Sent to ${sale.buyer_email}`);
    } catch (err: any) {
      toast.error('Resend failed', err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="md:grid md:grid-cols-[110px_80px_1fr_1.2fr_90px_100px_24px] gap-3 px-5 py-3.5 flex flex-col gap-2 hover:bg-[#16130e] transition-colors">
      <span className="text-[11px] font-mono text-[#a08a6a] tabular-nums">{fmtDate(sale.created_at)}</span>

      <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#6a5d4a]">
        <Icon size={11} className="text-[#5a5142]" />
        {sale.kind}
      </span>

      <div className="min-w-0">
        <p className="text-[12px] text-[#E8DCC8] truncate flex items-center gap-2">
          <span className="truncate">{sale.item_label}</span>
          {sale.needs_stems_upload && !delivered && (
            <span className="shrink-0 inline-flex items-center gap-1.5">
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.15em] bg-amber-500/15 border border-amber-500/35 text-amber-300"
                title="Buyer paid for exclusive — upload stems then deliver"
              >
                Awaiting stems
              </span>
              <button
                onClick={handleDeliverStems}
                disabled={delivering}
                title="Email the buyer that their stems are ready"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.15em] bg-[#6DC6A4]/15 border border-[#6DC6A4]/30 text-[#6DC6A4] hover:bg-[#6DC6A4]/25 transition-colors disabled:opacity-40"
              >
                {delivering ? <Loader2 size={9} className="animate-spin" /> : <Send size={9} />}
                Deliver
              </button>
            </span>
          )}
          {delivered && (
            <span className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase tracking-[0.15em] bg-[#6DC6A4]/15 border border-[#6DC6A4]/30 text-[#6DC6A4]">
              <Check size={9} /> Delivered
            </span>
          )}
        </p>
        {sale.license_type && (
          <p className="text-[9px] font-mono text-[#5a5142] uppercase tracking-wider mt-0.5">
            {sale.license_type}
          </p>
        )}
      </div>

      <span className="text-[11px] text-[#a08a6a] truncate" title={sale.buyer_email}>
        {sale.buyer_email}
      </span>

      <span className="text-[12px] font-mono font-bold text-white tabular-nums md:text-right">
        {fmtMoney(sale.amount_usd)}
      </span>

      <span
        className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border self-start md:self-center ${STATUS_STYLES[sale.status]}`}
      >
        {sale.status}
      </span>

      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={handleResend}
          disabled={resending || sale.status !== 'paid'}
          className="text-[#3a3328] hover:text-[#E8DCC8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={sale.status !== 'paid' ? `Cannot resend (${sale.status})` : `Resend delivery email to ${sale.buyer_email}`}
          aria-label="Resend delivery email"
        >
          {resending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
        </button>
        {stripeUrl && (
          <a
            href={stripeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#3a3328] hover:text-[#E8DCC8] transition-colors"
            title="Open in Stripe Dashboard"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>
  );
}
