'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Search, Download, Package, Music2, ChevronRight,
  RotateCcw, Loader2, MailCheck, AlertCircle, ArrowLeft,
} from 'lucide-react';
import { sanitizeUrl } from '@/components/store/helpers';

/* ─── Types ──────────────────────────────────────────────────── */

type TrackOrder = {
  id: string;
  kind: 'track_license';
  tracks: Array<{ id: string; title: string; cover_url?: string | null }>;
  license_type: string | null;
  amount_usd: number | null;
  created_at: string;
  stripe_session_id: string;
};

type ProjectOrder = {
  id: string;
  kind: 'project_bundle';
  project: { id: string; name: string; cover_url?: string | null };
  amount_usd: number | null;
  created_at: string;
  token: string;
  expires_at: string | null;
};

type Order = TrackOrder | ProjectOrder;

/* ─── Helpers ────────────────────────────────────────────────── */

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}
function fmtAmount(n: number | null) {
  if (n == null) return null;
  return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ─── Order card ─────────────────────────────────────────────── */

function OrderCard({ order, onResend, resending }: {
  order: Order;
  onResend: () => void;
  resending: boolean;
}) {
  const isTrack = order.kind === 'track_license';

  // Cover: first track cover, or project cover
  const coverUrl = sanitizeUrl(
    isTrack
      ? (order as TrackOrder).tracks[0]?.cover_url
      : (order as ProjectOrder).project.cover_url
  );

  const title = isTrack
    ? (order as TrackOrder).tracks.length === 1
      ? (order as TrackOrder).tracks[0].title
      : `${(order as TrackOrder).tracks.length} tracks`
    : (order as ProjectOrder).project.name;

  const badge = isTrack
    ? ((order as TrackOrder).license_type === 'exclusive' ? 'Exclusive' : 'Lease')
    : 'Bundle';

  const href = isTrack
    ? `/store/download?session_id=${(order as TrackOrder).stripe_session_id}`
    : `/store/projects/access/${(order as ProjectOrder).token}`;

  return (
    <div className="group flex flex-col sm:flex-row gap-4 rounded-[14px] p-[1.5px]"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 100%)' }}
    >
      <div className="flex flex-col sm:flex-row gap-4 rounded-[13px] bg-[#171511] p-4 w-full">
        {/* Cover */}
        <div className="shrink-0 w-full sm:w-16 h-40 sm:h-16 rounded-lg overflow-hidden bg-[#2B2821]">
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              {isTrack ? <Music2 size={20} className="text-[#6E685B]" /> : <Package size={20} className="text-[#6E685B]" />}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 flex flex-col justify-center gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[9px] font-mono uppercase tracking-[0.18em] px-1.5 py-0.5 rounded"
              style={{
                background: badge === 'Exclusive' ? 'rgba(231,215,190,0.15)' : 'rgba(255,255,255,0.06)',
                color: badge === 'Exclusive' ? '#E7D7BE' : '#D0C3AF',
                border: badge === 'Exclusive' ? '1px solid rgba(231,215,190,0.25)' : '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {badge}
            </span>
            {order.amount_usd != null && (
              <span className="text-[11px] font-bold text-[#F7EBDD] tabular-nums">
                {fmtAmount(order.amount_usd)}
              </span>
            )}
          </div>

          <p className="text-[14px] font-semibold text-[#F7EBDD] truncate leading-tight">{title}</p>

          {/* Track list for multi-track purchases */}
          {isTrack && (order as TrackOrder).tracks.length > 1 && (
            <p className="text-[11px] text-[#9B9282] truncate">
              {(order as TrackOrder).tracks.map(t => t.title).join(' · ')}
            </p>
          )}

          <p className="text-[10px] font-mono text-[#9B9282] uppercase tracking-wider mt-0.5">
            {fmtDate(order.created_at)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex sm:flex-col items-center gap-2 shrink-0 justify-end sm:justify-center">
          <Link
            href={href}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider transition-colors"
            style={{ background: 'rgba(231,215,190,0.12)', color: '#E7D7BE', border: '1px solid rgba(231,215,190,0.2)' }}
          >
            <Download size={12} />
            <span className="hidden sm:inline">Download</span>
            <ChevronRight size={11} className="sm:hidden" />
          </Link>

          <button
            onClick={onResend}
            disabled={resending}
            title="Re-send download email"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#D0C3AF] border border-[#2B2821] hover:border-[#3B372F] transition-colors disabled:opacity-40"
          >
            {resending ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
            <span className="hidden sm:inline">Re-send</span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────── */

export default function OrdersPage() {
  const [email, setEmail] = useState('');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resendOk, setResendOk] = useState<string | null>(null);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOrders(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/store/orders?email=${encodeURIComponent(email.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Lookup failed');
      setOrders(data.orders as Order[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  async function resend(order: Order) {
    setResendingId(order.id);
    setResendOk(null);
    try {
      const res = await fetch('/api/store/orders/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          purchase_id: order.id,
          kind: order.kind,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Re-send failed');
      setResendOk(order.id);
      setTimeout(() => setResendOk(null), 4000);
    } catch {
      // silent — user will try again
    } finally {
      setResendingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-[#090907] text-[#F7EBDD]">
      <div className="max-w-2xl mx-auto px-4 py-16 md:py-24">

        {/* Back to store */}
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#9B9282] hover:text-[#D0C3AF] transition-colors mb-10"
        >
          <ArrowLeft size={11} />
          Back to store
        </Link>

        {/* Header */}
        <div className="mb-10">
          <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#9B9282] mb-3">
            Order history
          </p>
          <h1 className="text-[28px] md:text-[36px] font-bold leading-tight mb-3">
            Find your purchases
          </h1>
          <p className="text-[14px] text-[#B4AA99] leading-relaxed">
            Enter the email you used at checkout to access your download links.
          </p>
        </div>

        {/* Email form */}
        <form onSubmit={lookup} className="mb-10">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#837B6D]" />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full bg-[#171511] border border-[#2B2821] focus:border-[#E7D7BE]/40 rounded-xl pl-9 pr-4 py-3 text-[14px] text-[#F7EBDD] placeholder-[#6E685B] outline-none transition-colors"
              />
            </div>
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="shrink-0 flex items-center gap-2 px-5 py-3 rounded-xl font-mono text-[11px] uppercase tracking-wider text-[#090907] bg-[#E7D7BE] hover:bg-[#F7EBDD] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : 'Look up'}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-[13px] mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Re-send confirmation */}
        {resendOk && (
          <div className="flex items-center gap-2 text-[#6DC6A4] text-[13px] mb-6 p-3 rounded-lg bg-[#6DC6A4]/10 border border-[#6DC6A4]/20">
            <MailCheck size={14} className="shrink-0" />
            Download link re-sent to {email}
          </div>
        )}

        {/* Results */}
        {orders !== null && (
          <div>
            {orders.length === 0 ? (
              <div className="text-center py-16">
                <p className="text-[14px] text-[#9B9282] mb-2">No purchases found for this email.</p>
                <p className="text-[12px] text-[#6E685B]">
                  Try the email you used at checkout, or{' '}
                  <Link href="/store" className="text-[#E7D7BE] hover:text-[#F7EBDD] transition-colors">
                    browse the store
                  </Link>.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-[#9B9282] mb-4">
                  {orders.length} purchase{orders.length === 1 ? '' : 's'} found
                </p>
                {orders.map((order) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    onResend={() => resend(order)}
                    resending={resendingId === order.id}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
