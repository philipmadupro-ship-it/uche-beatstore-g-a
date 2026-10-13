'use client';

/**
 * Legal readiness of an org song (LABEL-29, 09 §3.2): a popover chip with the
 * display percentage and the named gaps, and the Credits & Rights table of all
 * fourteen requirements under it. The rules are lib/labelos/legal-readiness;
 * this file only draws what the route sent.
 *
 * The percentage is a DISPLAY (R-11): it is never shown without the line that
 * says blockers decide, and it never reads 100 while a gap is open. A member
 * without `rights.read` is sent the counts only, so for them there is no
 * table and no names — the chip says how many gaps, not which.
 */
import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Popover } from '@/components/ui/Popover';
import { cn } from '@/lib/utils';
import { fetchLegalReadiness } from '@/lib/labelos/legal-readiness-client';
import type { FixCapability, FullReadiness, ReadinessView } from '@/lib/labelos/legal-readiness';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';

const FIX_AREA: Record<FixCapability, string> = {
  'catalog.write': 'Catalog',
  'rights.write': 'Rights',
  'release.write': 'Release',
};

export const countsText = (v: Pick<ReadinessView, 'blockerCount' | 'warningCount'>): string => {
  const b = `${v.blockerCount} blocker${v.blockerCount === 1 ? '' : 's'}`;
  const w = `${v.warningCount} warning${v.warningCount === 1 ? '' : 's'}`;
  return `${b} · ${w}`;
};

export function OrgLegalReadiness({ orgId, trackId }: { orgId: string; trackId: string }) {
  const [view, setView] = useState<ReadinessView | null>(null);
  const [hidden, setHidden] = useState(false);

  // A different song remounts this (the caller keys it by track).
  useEffect(() => {
    let live = true;
    void fetchLegalReadiness(orgId, trackId).then((res) => {
      if (!live) return;
      if (!res.ok || !res.schemaReady || !res.readiness) setHidden(true);
      else setView(res.readiness);
    });
    return () => {
      live = false;
    };
  }, [orgId, trackId]);

  if (hidden) return null;
  if (!view) return <div className="h-8" aria-hidden="true" data-testid="org-legal-loading" />;

  return (
    <section aria-labelledby="org-song-rights" data-testid="org-legal">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="org-song-rights" className={LABEL}>Credits &amp; rights</h2>
        <Popover
          width={340}
          align="right"
          label="Legal readiness"
          trigger={({ open, toggle, ref }) => (
            <button
              type="button"
              ref={ref as (el: HTMLButtonElement | null) => void}
              onClick={toggle}
              aria-expanded={open}
              data-testid="org-legal-chip"
              className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
            >
              <span>Legal readiness</span>
              <span className="font-mono text-[10px] text-white" data-testid="org-legal-percent">{view.percent}%</span>
              <span className={cn('font-mono text-[10px] uppercase tracking-[0.1em]', view.blockerCount > 0 ? 'text-red-400' : 'text-[#6DC6A4]')}>
                {view.blockerCount > 0 ? `${view.blockerCount} blocking` : 'no blockers'}
              </span>
            </button>
          )}
        >
          <ReadinessPanel view={view} />
        </Popover>
      </div>
      {view.detail === 'full' ? (
        <RequirementTable view={view} />
      ) : (
        <p className="text-[11px] text-white/40" data-testid="org-legal-counts">{countsText(view)}. Which ones needs access to rights.</p>
      )}
    </section>
  );
}

function ReadinessPanel({ view }: { view: ReadinessView }) {
  if (view.detail === 'counts') {
    return (
      <div className="space-y-2 p-3" data-testid="org-legal-panel">
        <p className="text-[13px] text-white">{countsText(view)}</p>
        <p className="text-[11px] text-white/40">The percentage is a display only. What is missing is visible to members with access to rights.</p>
      </div>
    );
  }
  const applicable = view.requirements.filter((q) => q.applicable);
  const done = applicable.filter((q) => q.satisfied);
  const missing = applicable.filter((q) => !q.satisfied);
  return (
    <div className="space-y-3 p-3" data-testid="org-legal-panel">
      <p className="text-[11px] text-white/40">
        {view.percent}% is a display only. Sending to legal and approvals look at blockers, not the percentage.
      </p>
      <div>
        <p className={`${LABEL} mb-1.5`}>Complete</p>
        {done.length === 0 ? (
          <p className="text-[11px] text-white/40">Nothing yet.</p>
        ) : (
          <ul className="space-y-1">
            {done.map((q) => (
              <li key={q.code} className="flex items-center gap-1.5 text-[11px] text-white/60"><Check size={11} className="text-[#6DC6A4]" aria-hidden="true" />{q.label}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className={`${LABEL} mb-1.5`}>Missing</p>
        {missing.length === 0 ? (
          <p className="text-[11px] text-white/40">Nothing is missing.</p>
        ) : (
          <ul className="space-y-1.5">
            {missing.map((q) =>
              q.reasons.map((r, i) => (
                <li key={`${q.code}-${i}`} className="flex items-start gap-1.5 text-[11px] text-white/80">
                  <X size={11} className={cn('mt-0.5 shrink-0', r.severity === 'blocker' ? 'text-red-400' : 'text-[#c8a47a]')} aria-hidden="true" />
                  <span>
                    {r.message}
                    <span className="ml-1 text-white/40">({FIX_AREA[r.fixCapability]}{r.severity === 'warning' ? ' · warning' : ''})</span>
                  </span>
                </li>
              )),
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequirementTable({ view }: { view: FullReadiness }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10 bg-[#0D0D0A]">
      <table className="w-full min-w-[520px] text-left" data-testid="org-legal-table">
        <caption className="sr-only">Legal requirements for this song</caption>
        <thead>
          <tr className="border-b border-white/[0.06]">
            <th scope="col" className={`${LABEL} px-3 py-2 font-normal`}>Requirement</th>
            <th scope="col" className={`${LABEL} px-3 py-2 font-normal`}>Status</th>
            <th scope="col" className={`${LABEL} px-3 py-2 font-normal`}>Fix in</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">
          {view.requirements.map((q) => (
            <tr key={q.code} data-testid={`org-legal-row-${q.code}`} data-state={!q.applicable ? 'na' : q.satisfied ? 'ok' : q.severity}>
              <td className="px-3 py-2 align-top">
                <p className="text-[13px] text-white/80">{q.label}</p>
                {q.reasons.map((r, i) => (
                  <p key={i} className="mt-0.5 text-[11px] text-white/40">{r.message}</p>
                ))}
              </td>
              <td className="px-3 py-2 align-top text-[11px]">
                {!q.applicable ? (
                  <span className="text-white/30">Not applicable</span>
                ) : q.satisfied ? (
                  <span className="text-[#6DC6A4]">Complete</span>
                ) : q.severity === 'blocker' ? (
                  <span className="text-red-400">Blocker</span>
                ) : (
                  <span className="text-[#c8a47a]">Warning</span>
                )}
              </td>
              <td className="px-3 py-2 align-top text-[11px] text-white/40">{q.satisfied || !q.applicable ? '' : FIX_AREA[q.fixCapability]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
