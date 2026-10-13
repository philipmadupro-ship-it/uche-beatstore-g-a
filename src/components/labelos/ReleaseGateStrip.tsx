/**
 * The seven gates of a release as one strip (LABEL-33, 09 §4): a short name
 * and a dot per gate, tone from the gate's status. A strip is information, not
 * a control — it cannot move a release anywhere (07 §2.5); the release's own
 * page is where a gate is read and worked.
 */
import { cn } from '@/lib/utils';
import { GATE_SHORT, gateTone, gateWord, gateSummary, type BoardGate, type GateTone } from '@/lib/labelos/release-board';
import { RELEASE_GATE_LABEL } from '@/lib/labelos/release-readiness';

export const TONE_TEXT: Record<GateTone, string> = {
  good: 'border-[#6DC6A4]/40 text-[#6DC6A4]',
  warn: 'border-[#c8a47a]/40 text-[#c8a47a]',
  waiting: 'border-white/20 text-white/80',
  neutral: 'border-white/10 text-white/40',
};

export function ReleaseGateStrip({ gates }: { gates: readonly BoardGate[] }) {
  if (gates.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label={gateSummary(gates)} data-testid="release-gate-strip">
      {gates.map((g) => {
        const word = gateWord(g.status);
        const detail = g.blockerCount > 0 ? `${word} · ${g.blockerCount} to fix` : word;
        return (
          <span
            key={g.gate}
            role="listitem"
            title={`${RELEASE_GATE_LABEL[g.gate]}: ${detail}`}
            aria-label={`${RELEASE_GATE_LABEL[g.gate]}: ${detail}`}
            data-gate={g.gate}
            data-status={g.status}
            className={cn('rounded-lg border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em]', TONE_TEXT[gateTone(g.status)])}
          >
            {GATE_SHORT[g.gate]}
          </span>
        );
      })}
    </div>
  );
}
