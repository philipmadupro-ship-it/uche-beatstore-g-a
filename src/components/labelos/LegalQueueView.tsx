'use client';

/**
 * The legal queue (LABEL-31, 09 §3.3): the songs and releases somebody has
 * asked legal to look at, ready ones first, then oldest first. The order and
 * what each member may see are the server's (`legal-queue`, the route); this
 * draws what it was sent. A row says whether the subject has legal blockers —
 * never a percentage, which would imply partial sufficiency — who asked, and
 * how long ago. A song opens at its own page, where the approval control and
 * the readiness checklist are; a release offers its legal pack to the members
 * allowed to export it (`contracts.read` and `rights.read`).
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { canExportLegalPack, type LegalQueueItem } from '@/lib/labelos/legal-queue';
import { fetchLegalQueue, legalPackHref, type LegalQueueResult } from '@/lib/labelos/legal-queue-client';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const NOTICE = 'rounded-xl border border-white/10 bg-[#0D0D0A] px-4 py-8 text-center text-[11px] text-white/60';
const LINK = 'inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]';

/** "today", "1 day", "5 days", "3 weeks", "4 months": how long a request has waited. */
export function waitingFor(iso: string, now: Date = new Date()): string {
  const days = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000));
  if (days < 1) return 'today';
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 60) return `${Math.floor(days / 7)} weeks`;
  return `${Math.floor(days / 30)} months`;
}

export function LegalQueueView({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const shell = useOrgShell();
  const mayExport = shell ? canExportLegalPack(new Set(shell.capabilities)) : false;
  const [result, setResult] = useState<LegalQueueResult | null>(null);

  const load = useCallback(async () => {
    setResult(await fetchLegalQueue(orgId));
  }, [orgId]);
  useEffect(() => {
    let live = true;
    void fetchLegalQueue(orgId).then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, [orgId]);

  if (!result) return <p className="text-[11px] text-white/40" data-testid="legal-loading">Loading the queue…</p>;
  if (!result.ok) {
    return (
      <div className={NOTICE} data-testid="legal-failed">
        {result.error}
        <button type="button" className={`${LINK} ml-3`} onClick={() => void load()}>Try again</button>
      </div>
    );
  }
  if (!result.schemaReady) return <p className={NOTICE} data-testid="legal-not-ready">The legal queue is not set up yet: the database migrations for approvals, credits and split sheets are not all applied.</p>;

  return (
    <div className="space-y-4" data-testid="legal-queue">
      {result.items.length === 0 ? (
        <p className={NOTICE} data-testid="legal-empty">Nothing is waiting for legal.</p>
      ) : (
        <ul className="space-y-2">
          {result.items.map((item) => (
            <Row key={`${item.kind}:${item.id}`} item={item} orgId={orgId} orgSlug={orgSlug} mayExport={mayExport} />
          ))}
        </ul>
      )}
      {result.restricted > 0 && (
        <p className="text-[11px] text-white/40" data-testid="legal-restricted">
          {result.restricted} more {result.restricted === 1 ? 'request is' : 'requests are'} waiting on songs or releases you cannot open.
        </p>
      )}
      {result.truncated && <p className="text-[11px] text-white/40">Showing the oldest requests only.</p>}
    </div>
  );
}

function Row({ item, orgId, orgSlug, mayExport }: { item: LegalQueueItem; orgId: string; orgSlug: string; mayExport: boolean }) {
  const title = item.title ?? (item.kind === 'song' ? 'Untitled song' : 'Untitled release');
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="legal-row" data-ready={item.ready ? 'true' : 'false'}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={LABEL}>{item.kind === 'song' ? 'Song' : 'Release'}</span>
          {item.kind === 'song' ? (
            <Link href={`/o/${orgSlug}/songs/${item.id}`} className="truncate text-[13px] text-white hover:underline">{title}</Link>
          ) : (
            <span className="truncate text-[13px] text-white">{title}</span>
          )}
          {item.askedOfMe && <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em] text-white/80">Asked of you</span>}
        </div>
        <p className="mt-1 text-[11px] text-white/60">
          {item.artist ? `${item.artist.name} · ` : ''}
          {item.requestedBy ? `Asked by ${item.requestedBy} · ` : ''}waiting {waitingFor(item.requestedAt)}
        </p>
      </div>
      <span
        className={cn(
          'rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]',
          item.ready ? 'border-[#6DC6A4]/40 text-[#6DC6A4]' : 'border-[#c8a47a]/40 text-[#c8a47a]',
        )}
        data-testid="legal-readiness"
      >
        {item.ready ? 'No blockers' : `${item.blockers} ${item.blockers === 1 ? 'blocker' : 'blockers'}`}
      </span>
      {item.kind === 'release' && mayExport && (
        <a href={legalPackHref(orgId, item.id)} className={LINK} data-testid="legal-pack-link">
          <Download size={12} strokeWidth={1.75} aria-hidden="true" />
          Legal pack
        </a>
      )}
    </li>
  );
}
