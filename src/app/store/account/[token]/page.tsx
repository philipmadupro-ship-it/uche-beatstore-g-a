'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, AlertCircle, Music, Layers, Download, ExternalLink,
  CreditCard,
} from 'lucide-react';

interface TrackLicense {
  id: string;
  kind: 'track';
  items: Array<{ track_id: string; license_id: string; license_type: string }>;
  amount_usd: number;
  created_at: string;
  status: string | null;
  stripe_session_id: string | null;
  download_url: string | null;
}

interface ProjectBundle {
  id: string;
  kind: 'project';
  project: { name: string; cover_url: string | null };
  project_id: string;
  amount_usd: number;
  created_at: string;
  stripe_session_id: string | null;
  download_url: string | null;
}

interface AccountData {
  email: string;
  track_licenses: TrackLicense[];
  project_bundles: ProjectBundle[];
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtMoney(n: number) {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function AccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/store/account/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        setData(json);
      } catch (err: any) {
        setError(err.message || 'Could not load your account.');
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const openPortal = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res = await fetch('/api/store/account/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      window.location.href = json.url;
    } catch (err: any) {
      setPortalError(err.message || 'Could not open Stripe portal.');
    } finally {
      setPortalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0907] flex items-center justify-center">
        <Loader2 size={20} className="animate-spin text-[#4a4338]" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8] flex items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <AlertCircle size={28} className="text-red-400 mx-auto mb-3" />
          <p className="text-[14px] font-medium text-[#E8DCC8] mb-1">Couldn't open your account</p>
          <p className="text-[11px] text-[#a08a6a] mb-5">{error || 'Unknown error.'}</p>
          <Link
            href="/store/account"
            className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  const totalSpent =
    data.track_licenses.reduce((s, r) => s + r.amount_usd, 0) +
    data.project_bundles.reduce((s, r) => s + r.amount_usd, 0);
  const purchaseCount = data.track_licenses.length + data.project_bundles.length;
  const isEmpty = purchaseCount === 0;

  return (
    <div className="min-h-screen bg-[#0a0907] text-[#E8DCC8]">
      <div className="max-w-[760px] mx-auto px-4 py-10 md:py-14">
        <Link
          href="/store"
          className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-[#6a5d4a] hover:text-[#E8DCC8] transition-colors mb-8"
        >
          <ArrowLeft size={12} />
          Back to store
        </Link>

        <p className="text-[10px] font-mono uppercase tracking-[0.3em] text-[#a08a6a] mb-2">My account</p>
        <h1 className="text-[28px] sm:text-[36px] font-bold text-white leading-none tracking-tight font-heading">
          Your purchases
        </h1>
        <p className="mt-2 text-[12px] text-[#6a5d4a]">
          Signed in as <span className="text-[#E8DCC8]">{data.email}</span>.
        </p>

        {!isEmpty && (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">Purchases</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{purchaseCount}</p>
            </div>
            <div className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
              <p className="text-[9px] font-mono uppercase tracking-wider text-[#5a5142]">Total spent</p>
              <p className="text-[20px] font-bold text-white tabular-nums mt-1">{fmtMoney(totalSpent)}</p>
            </div>
          </div>
        )}

        {isEmpty ? (
          <div className="mt-10 rounded-2xl border border-[#1f1a13] bg-[#14110d] px-6 py-16 text-center">
            <Music size={28} className="text-[#3a3328] mx-auto mb-3" />
            <p className="text-[14px] text-[#E8DCC8] font-medium mb-1">No purchases yet</p>
            <p className="text-[12px] text-[#6a5d4a] max-w-md mx-auto mb-5">
              Once you license a beat or buy a project bundle, it'll show up here. The link in this URL stays valid for 24h.
            </p>
            <Link
              href="/store"
              className="inline-block text-[10px] font-mono uppercase tracking-wider px-4 py-2 rounded-md bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] transition-colors"
            >
              Browse beats
            </Link>
          </div>
        ) : (
          <>
            {data.project_bundles.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-3 flex items-center gap-2">
                  <Layers size={11} />
                  Project bundles ({data.project_bundles.length})
                </h2>
                <ul className="space-y-2">
                  {data.project_bundles.map((b) => (
                    <li
                      key={b.id}
                      className="flex items-center gap-3 rounded-xl border border-[#1f1a13] bg-[#14110d] px-3 py-3"
                    >
                      <div className="w-12 h-12 rounded-lg overflow-hidden bg-[#0a0907] border border-[#1f1a13] shrink-0">
                        {b.project.cover_url
                          ? <img src={b.project.cover_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[#3a3328]"><Layers size={14} /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-[#E8DCC8] truncate">{b.project.name}</p>
                        <p className="text-[10px] font-mono text-[#5a5142] mt-0.5">
                          {fmtDate(b.created_at)} · {fmtMoney(b.amount_usd)}
                        </p>
                      </div>
                      {b.download_url && (
                        <a
                          href={b.download_url}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-[#D4BFA0] text-black hover:bg-[#E8D8B8] transition-colors"
                        >
                          <Download size={11} />
                          Open
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {data.track_licenses.length > 0 && (
              <section className="mt-10">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-[#a08a6a] mb-3 flex items-center gap-2">
                  <Music size={11} />
                  Track licenses ({data.track_licenses.length})
                </h2>
                <ul className="space-y-2">
                  {data.track_licenses.map((r) => (
                    <li
                      key={r.id}
                      className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-medium text-[#E8DCC8]">
                            {r.items.length} track{r.items.length === 1 ? '' : 's'} · {fmtMoney(r.amount_usd)}
                          </p>
                          <p className="text-[10px] font-mono text-[#5a5142] mt-0.5">
                            {fmtDate(r.created_at)}{r.status ? ` · ${r.status}` : ''}
                          </p>
                        </div>
                        {r.download_url && (
                          <a
                            href={r.download_url}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider bg-white/[0.06] border border-white/[0.10] text-[#E8DCC8] hover:bg-white/[0.12] transition-colors"
                          >
                            <Download size={11} />
                            Open
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-10 rounded-2xl border border-[#1f1a13] bg-[#14110d] px-5 py-5">
              <div className="flex items-start gap-3">
                <CreditCard size={16} className="text-[#a08a6a] mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-[12px] font-medium text-[#E8DCC8]">Invoices &amp; payment methods</p>
                  <p className="text-[11px] text-[#6a5d4a] mt-1 leading-relaxed">
                    Manage your Stripe-side payment details, download invoices, or update billing email.
                  </p>
                  {portalError && (
                    <p className="text-[11px] text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2 mt-3">
                      {portalError}
                    </p>
                  )}
                </div>
                <button
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-md text-[10px] font-mono uppercase tracking-wider border border-[#2d2620] text-[#E8DCC8] hover:border-[#3a3328] hover:bg-white/[0.04] transition-colors disabled:opacity-40"
                >
                  {portalLoading
                    ? <Loader2 size={11} className="animate-spin" />
                    : <ExternalLink size={11} />}
                  Open portal
                </button>
              </div>
            </section>
          </>
        )}

        <footer className="mt-10 pt-6 border-t border-[#1a160f]">
          <p className="text-[10px] font-mono text-[#3a3328] leading-relaxed">
            This link expires 24h after you requested it. If it stops working,{' '}
            <Link href="/store/account" className="text-[#6a5d4a] hover:text-[#E8DCC8] underline underline-offset-2">
              request a fresh one
            </Link>.
          </p>
        </footer>
      </div>
    </div>
  );
}
