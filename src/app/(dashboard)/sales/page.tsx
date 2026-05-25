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
  DollarSign, ShoppingBag, AlertCircle, Send,
} from 'lucide-react';
import { toast } from '@/hooks/useToast';

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
  }, []);

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

  return (
    <DashboardLayout>
      <div className="max-w-[1100px] mx-auto px-4 sm:px-6 md:px-10 pt-6 md:pt-10 pb-32">
        {/* Header */}
        <div className="mb-8">
          <p className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-1">Dashboard</p>
          <h1 className="text-[28px] sm:text-[36px] font-bold tracking-tight text-white leading-none font-heading">
            Sales
          </h1>
          <p className="text-[12px] text-[#6a5d4a] mt-1.5">
            All completed purchases — track licenses and project bundles.
          </p>
        </div>

        {/* Totals strip */}
        {totals && totals.count > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <StatCard label="Revenue" value={fmtMoney(totals.revenue_usd)} icon={<DollarSign size={14} />} />
            <StatCard label="Sales" value={String(totals.count)} icon={<ShoppingBag size={14} />} />
            <StatCard label="Tracks" value={String(totals.track_count)} icon={<Music size={14} />} />
            <StatCard label="Projects" value={String(totals.project_count)} icon={<Layers size={14} />} />
          </div>
        )}

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
          <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] py-20 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-[#4a4338]" />
          </div>
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
      </div>
    </DashboardLayout>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[#5a5142] mb-1">
        {icon}
        <span className="text-[9px] font-mono uppercase tracking-[0.2em]">{label}</span>
      </div>
      <p className="text-[18px] font-bold text-white tabular-nums">{value}</p>
    </div>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const Icon = sale.kind === 'project' ? Layers : Music;
  const stripeUrl = sale.stripe_session_id
    ? `https://dashboard.stripe.com/payments/${sale.stripe_session_id}`
    : null;
  const [resending, setResending] = useState(false);
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
        <p className="text-[12px] text-[#E8DCC8] truncate">{sale.item_label}</p>
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
