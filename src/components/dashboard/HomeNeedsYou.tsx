'use client';

/**
 * "Needs you" — the one block on Home that says whether anything is waiting.
 *
 * Replaces ActionDigestPanel's collapsed accordion. The rows are visible and are
 * links, so the producer acts without an expand click. See
 * lib/dashboard/home-attention.ts for the loading / clear / error rules: this
 * file only fetches and draws. Each source degrades on its own.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, ChevronDown, ChevronUp, Handshake, ShoppingBag, UserPlus } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { buildActionDigest, type DigestItem, type DigestLeadRow, type DigestOfferRow, type DigestSaleRow } from '@/lib/dashboard/action-digest';
import { buildHomeAttention, type AttentionSources, type HomeAttention, type SourceState } from '@/lib/dashboard/home-attention';

const ICONS: Record<DigestItem['domain'], React.ComponentType<{ size?: number; className?: string }>> = {
  sales: ShoppingBag,
  offers: Handshake,
  crm: UserPlus,
};
const SOURCE_NAMES = { sales: 'Sales', offers: 'Offers', leads: 'Contacts' } as const;
const SHELL = 'rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3';

export function HomeNeedsYouView({
  attention,
  expandable,
  allItems,
  quietWhenClear,
  children,
}: {
  attention: HomeAttention;
  allItems: DigestItem[];
  expandable?: boolean;
  /** A brand-new workspace has nothing to be "clear" about. */
  quietWhenClear?: boolean;
  /** Secondary diagnostics (sell readiness) live inside the same block. */
  children?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? allItems.slice(0, 50) : attention.rows;
  const failed = attention.failedSources.map((k) => SOURCE_NAMES[k]).join(', ');

  if (attention.status === 'loading') {
    return (
      <div className="space-y-3">
        <div className={SHELL} data-testid="needs-you" data-status="loading" aria-busy="true">
          <div className={`h-3 w-40 rounded bg-white/[0.08] ${reducedMotion ? '' : 'animate-pulse'}`} />
        </div>
        {children}
      </div>
    );
  }
  if (attention.status === 'clear' && quietWhenClear) return <>{children}</>;

  return (
    <div className="space-y-3">
      <section className={SHELL} data-testid="needs-you" data-status={attention.status} aria-label="Needs you">
        {attention.status === 'items' ? (
          <>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/60">
                Needs you · {attention.total}
              </h2>
              <span className="truncate font-mono text-[10px] text-white/40">{attention.summary}</span>
            </div>
            <ul>
              {rows.map((item) => {
                const Icon = ICONS[item.domain];
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="-mx-2 flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                    >
                      <Icon size={12} className="shrink-0 text-white/50" />
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-white/60">{item.label}</span>
                      <span className="min-w-0 truncate text-[11px] text-white/80">{item.detail}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {expandable && attention.total > attention.rows.length ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                className="mt-1 flex items-center gap-1 rounded px-1 py-1 font-mono text-[10px] uppercase tracking-wider text-white/50 transition-colors hover:text-white/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
              >
                {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                {expanded ? 'Show less' : `${attention.moreCount} more`}
              </button>
            ) : null}
            {failed ? (
              <p className="mt-2 font-mono text-[10px] text-white/50" role="status">
                Couldn’t load {failed}, so this may be incomplete.
              </p>
            ) : null}
          </>
        ) : attention.status === 'clear' ? (
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60" role="status">
            <Check size={12} className="text-[#6DC6A4]" aria-hidden /> Nothing waiting on sales, offers or contacts
          </p>
        ) : (
          <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/60" role="status">
            <AlertTriangle size={12} aria-hidden /> Couldn’t load {failed || 'what needs you'} — refresh to check
          </p>
        )}
      </section>
      {children}
    </div>
  );
}

export function HomeNeedsYou({ quietWhenClear, children }: { quietWhenClear?: boolean; children?: React.ReactNode }) {
  const [sales, setSales] = useState<DigestSaleRow[]>([]);
  const [offers, setOffers] = useState<DigestOfferRow[]>([]);
  const [leads, setLeads] = useState<DigestLeadRow[]>([]);
  const [sources, setSources] = useState<AttentionSources>({ sales: 'loading', offers: 'loading', leads: 'loading' });

  useEffect(() => {
    let alive = true;
    const load = async <T,>(key: keyof AttentionSources, url: string, pick: (j: unknown) => T | null, set: (v: T) => void) => {
      let state: SourceState = 'error';
      try {
        const r = await fetch(url);
        if (r.ok) {
          const v = pick(await r.json());
          if (v) { set(v); state = 'ok'; }
        }
      } catch { /* state stays 'error' */ }
      if (alive) setSources((s) => ({ ...s, [key]: state }));
    };
    const arr = <T,>(k: string) => (j: unknown): T[] | null => {
      const v = (j as Record<string, unknown> | null)?.[k];
      return Array.isArray(v) ? (v as T[]) : null;
    };
    void load('sales', '/api/sales', arr<DigestSaleRow>('sales'), setSales);
    void load('offers', '/api/store/offer', arr<DigestOfferRow>('offers'), setOffers);
    void load('leads', '/api/contacts?crm_status=prospect&limit=20', (j) => (Array.isArray(j) ? (j as DigestLeadRow[]) : null), setLeads);
    return () => { alive = false; };
  }, []);

  const digest = useMemo(() => buildActionDigest({ sales, offers, leads }), [sales, offers, leads]);
  const attention = useMemo(() => buildHomeAttention({ digest, sources }), [digest, sources]);

  return (
    <HomeNeedsYouView attention={attention} allItems={digest.items} expandable quietWhenClear={quietWhenClear}>
      {children}
    </HomeNeedsYouView>
  );
}
