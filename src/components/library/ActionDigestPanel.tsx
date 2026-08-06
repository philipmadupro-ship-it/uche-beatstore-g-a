'use client';

/**
 * "What needs me today" — cross-surface action digest for Home.
 *
 * Sits alongside SellReadinessPanel (catalog issues) but covers everything
 * SellReadinessPanel deliberately doesn't: stuck sales, pending offers, and
 * new CRM leads — three things that already have a home on /sales and
 * /contacts, but no single place says "you have some." See
 * lib/dashboard/action-digest.ts for why this exists.
 *
 * Self-fetches its three sources independently and degrades per-source: if
 * one fetch fails, the other two still render. A digest that goes blank
 * because one endpoint hiccupped is worse than a slightly incomplete one.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, ChevronDown, ChevronUp, ShoppingBag, Handshake, UserPlus } from 'lucide-react';
import { Disclosure } from '@/components/ui/Disclosure';
import {
  buildActionDigest,
  type DigestItem,
  type DigestSaleRow,
  type DigestOfferRow,
  type DigestLeadRow,
} from '@/lib/dashboard/action-digest';

const DOMAIN_META: Record<DigestItem['domain'], { icon: React.ComponentType<{ size?: number; className?: string }>; tint: string }> = {
  sales:  { icon: ShoppingBag, tint: '#e8a86a' },
  offers: { icon: Handshake,   tint: '#E8DCC8' },
  crm:    { icon: UserPlus,    tint: '#c8a84b' },
};

export function ActionDigestPanel() {
  const [sales, setSales] = useState<DigestSaleRow[]>([]);
  const [offers, setOffers] = useState<DigestOfferRow[]>([]);
  const [leads, setLeads] = useState<DigestLeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.allSettled([
      fetch('/api/sales').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/store/offer').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/contacts?crm_status=prospect&limit=20').then((r) => (r.ok ? r.json() : null)),
    ]).then(([salesRes, offersRes, leadsRes]) => {
      if (!alive) return;
      if (salesRes.status === 'fulfilled' && salesRes.value?.sales) setSales(salesRes.value.sales);
      if (offersRes.status === 'fulfilled' && offersRes.value?.offers) setOffers(offersRes.value.offers);
      if (leadsRes.status === 'fulfilled' && Array.isArray(leadsRes.value)) setLeads(leadsRes.value);
      setLoading(false);
    });
    return () => { alive = false; };
  }, []);

  const digest = useMemo(() => buildActionDigest({ sales, offers, leads }), [sales, offers, leads]);

  if (loading || digest.total === 0) return null;

  const visible = digest.items.slice(0, expanded ? 50 : 4);

  // Collapsed, like every other diagnostic block above the catalogue. The
  // headline is the part that must be seen — it names how much is waiting;
  // the items themselves are what you read once you have decided to act.
  // Rendering them permanently put a second wall between the producer and
  // their library, which is the habit this app has been moving away from.
  const byDomain = digest.items.reduce<Record<string, number>>((acc, item) => {
    acc[item.domain] = (acc[item.domain] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <Disclosure
      className="mb-6"
      title={`${digest.total} ${digest.total === 1 ? 'thing needs' : 'things need'} you`}
      // A collapsed section still has to say what is inside it.
      summary={Object.entries(byDomain).map(([d, n]) => `${n} ${d}`).join(' · ')}
      icon={<Bell size={13} className="text-white/50" aria-hidden />}
    >
      <ul className="space-y-1">
        {visible.map((item) => {
          const meta = DOMAIN_META[item.domain];
          const Icon = meta.icon;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                className="flex items-center gap-2.5 rounded py-1.5 transition-colors hover:bg-white/[0.03]"
              >
                <Icon size={12} className="shrink-0" />
                <span
                  className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]"
                  style={{ color: meta.tint }}
                >
                  {item.label}
                </span>
                <span className="min-w-0 truncate text-[12px] text-white/70">{item.detail}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      {digest.total > 4 ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:text-white/70"
        >
          {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          {expanded ? 'Show less' : `Show all ${digest.total}`}
        </button>
      ) : null}
    </Disclosure>
  );
}
