'use client';

/**
 * "Check this tier" — the automatic check for one license tier, shown under
 * its editor in the License Builder. Collapsed by default; the header carries
 * the count so a clean tier costs one line. All logic is in
 * lib/license/analysis.ts.
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { DISCLAIMER, type Analysis, type Finding, type Severity } from '@/lib/license/analysis';

const SEVERITY_LABEL: Record<Severity, string> = { risk: 'Risk', warn: 'Warning', info: 'Note' };
const SEVERITY_DOT: Record<Severity, string> = {
  risk: 'bg-[#ff8b73]',
  warn: 'bg-[#c8a47a]',
  info: 'bg-white/40',
};
const VISIBLE = 5;

function Row({ f }: { f: Finding }) {
  return (
    <li className="flex gap-2.5" data-testid="license-finding" data-code={f.code}>
      <span aria-hidden className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[f.severity]}`} />
      <div className="min-w-0">
        <p className="text-[11px] leading-snug text-white/80">
          <span className="mr-1.5 font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">{SEVERITY_LABEL[f.severity]}</span>
          {f.message}
        </p>
        <p className="mt-0.5 text-[11px] leading-snug text-white/40">{f.suggestion}</p>
      </div>
    </li>
  );
}

export function LicenseAnalysisPanel({ tierId, analysis }: { tierId: string; analysis: Analysis }) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const own = analysis.perTier[tierId] ?? [];
  const findings = [...own, ...analysis.general];
  const shown = all ? findings : findings.slice(0, VISIBLE);
  const count = findings.length;

  return (
    <div className="rounded-xl border border-white/10" data-testid="license-analysis">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Check this tier"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Check</span>
        <span className="flex items-center gap-2 whitespace-nowrap text-[11px] text-white/60">
          {count === 0 ? 'Nothing to flag' : `${count} to look at`}
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/10 px-3 py-3">
          <p className="text-[10px] text-white/40">{DISCLAIMER}</p>
          {count === 0 ? (
            <p className="text-[11px] text-white/60">No conflicts or gaps found in this tier.</p>
          ) : (
            <ul className="space-y-2.5">
              {shown.map((f, i) => <Row key={`${f.code}-${f.tierId ?? 'set'}-${i}`} f={f} />)}
            </ul>
          )}
          {!all && findings.length > VISIBLE && (
            <button type="button" onClick={() => setAll(true)} className="text-[11px] text-white/60 underline-offset-2 hover:text-white/80 hover:underline">
              Show {findings.length - VISIBLE} more
            </button>
          )}
          {analysis.comparison.length > 1 && (
            <div className="space-y-1.5 border-t border-white/10 pt-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-white/40">Compared with your other tiers</p>
              <ul className="space-y-1">
                {analysis.comparison.map((c) => (
                  <li key={c.id} className={`text-[11px] leading-snug ${c.id === tierId ? 'text-white/80' : 'text-white/40'}`}>
                    <span className="font-semibold">{c.name}</span> — {c.line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
