'use client';

/**
 * "Not earning yet" — the beats that cannot be bought, and why.
 *
 * Lives in the library rather than the store editor on purpose. The store
 * editor's existing panel inspects beats that are already listed, which
 * excludes the ones that need attention most: everything uploaded and never
 * published. And the library is where the producer already is after an upload,
 * so it is where the gap should be named.
 *
 * Deliberately not a modal or a wizard. The producer did not ask to be
 * onboarded; they want to know what is costing them money and get on with it.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import {
  summariseReadiness,
  isHardBlocker,
  BLOCKER_LABELS,
  BLOCKER_REASONS,
  type ReadinessTrack,
} from '@/lib/store/readiness';

interface Props {
  tracks: ReadinessTrack[];
  /** Whether creator_profiles carries a fallback price. */
  hasDefaultPrice: boolean;
}

export function SellReadinessPanel({ tracks, hasDefaultPrice }: Props) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(
    () => summariseReadiness(tracks, hasDefaultPrice),
    [tracks, hasDefaultPrice],
  );

  // Nothing outstanding — say nothing. A panel that congratulates you every
  // visit becomes furniture, and furniture gets ignored when it finally matters.
  if (summary.blockedCount === 0) return null;

  const worst = summary.tracks.filter((t) => !t.sellable).slice(0, expanded ? 50 : 4);

  // Headline on what CANNOT BE BOUGHT, not on everything outstanding. Saying
  // "0 ready to sell" while five beats are genuinely listed and priced — just
  // without covers — is false, and an overstating diagnostic gets ignored.
  const headline = summary.unpurchasableCount > 0
    ? `${summary.unpurchasableCount} ${summary.unpurchasableCount === 1 ? 'beat' : 'beats'} nobody can buy`
    : `${summary.blockedCount} ${summary.blockedCount === 1 ? 'beat' : 'beats'} could sell better`;

  return (
    <section className="mb-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle size={13} className="text-amber-400/80" aria-hidden />
          <h2 className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-400/80">
            {headline}
          </h2>
        </div>
        <p className="font-mono text-[10px] tabular-nums text-white/35">
          {summary.purchasableCount} purchasable
        </p>
      </div>

      {/* Blockers first, ordered by how many beats each affects — that is the
          order in which fixing one thing pays off most. */}
      <ul className="mb-3 space-y-1.5">
        {summary.byBlocker.map(({ blocker, count }) => (
          <li key={blocker} className="flex items-baseline gap-2 text-[11px]">
            <span
              className={`w-7 shrink-0 text-right font-mono tabular-nums ${
                isHardBlocker(blocker) ? 'text-amber-300/90' : 'text-white/45'
              }`}
            >
              {count}
            </span>
            <span className="text-white/70">{BLOCKER_LABELS[blocker]}</span>
            <span className="min-w-0 truncate text-white/35">{BLOCKER_REASONS[blocker]}</span>
          </li>
        ))}
      </ul>

      <div className="border-t border-white/[0.06] pt-2.5">
        <ul className="space-y-1">
          {worst.map((track) => (
            <li key={track.id}>
              {/* Straight to the track, where every blocker can be fixed —
                  rather than sending the producer to a third screen. */}
              <Link
                href={`/library/${track.id}`}
                className="flex items-baseline justify-between gap-3 rounded py-1 transition-colors hover:bg-white/[0.03]"
              >
                <span className="min-w-0 truncate text-[12px] text-white/80">{track.title}</span>
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-white/35">
                  {track.blockers.map((b) => BLOCKER_LABELS[b]).join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>

        {summary.blockedCount > 4 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-white/40 transition-colors hover:text-white/70"
          >
            {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            {expanded ? 'Show less' : `Show all ${summary.blockedCount}`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
