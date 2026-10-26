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
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { fetchLegalReadiness } from '@/lib/labelos/legal-readiness-client';
import type { FixCapability, FullReadiness, ReadinessView, SamplesDeclared } from '@/lib/labelos/legal-readiness';
import { fetchSamples, saveSamples, type SamplesPayload } from '@/lib/labelos/samples-client';
import { SAMPLES_LABEL, SAMPLES_VALUES } from '@/lib/labelos/samples';

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
  // Bumped when the sample declaration changes: readiness is derived, so it is read again.
  const [rev, setRev] = useState(0);

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
  }, [orgId, trackId, rev]);

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
      <SamplesControl orgId={orgId} trackId={trackId} onSaved={() => setRev((n) => n + 1)} />
      {view.detail === 'full' ? (
        <RequirementTable view={view} />
      ) : (
        <p className="text-[11px] text-white/40" data-testid="org-legal-counts">{countsText(view)}. Which ones needs access to rights.</p>
      )}
    </section>
  );
}

const CHIP = 'rounded-lg border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-40';
const CHIP_REST = 'border-white/10 bg-white/[0.06] text-white/60 hover:border-white/20 hover:bg-white/[0.10]';
const CHIP_ON = 'border-white/30 bg-white/[0.14] text-white';

/**
 * L8 (09 §3.1): whether the song uses samples, and a clearance note when it
 * does. Anyone with `catalog.read` sees the declaration; `catalog.write` sets
 * it. Declaring "no samples" or "not declared" drops the note (the server
 * does it, `planSamples`). Renders nothing before migration 156 or on 403/404.
 */
function SamplesControl({ orgId, trackId, onSaved }: { orgId: string; trackId: string; onSaved: () => void }) {
  const [samples, setSamples] = useState<SamplesPayload | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchSamples(orgId, trackId).then((res) => {
      if (!live || !res.ok || !res.schemaReady || !res.samples) return;
      setSamples(res.samples);
      setNote(res.samples.note ?? '');
    });
    return () => {
      live = false;
    };
  }, [orgId, trackId]);

  if (!samples) return null;

  const save = async (value: SamplesDeclared, withNote?: string) => {
    setBusy(true);
    const res = await saveSamples(orgId, trackId, value === 'yes' && withNote !== undefined ? { samples: value, note: withNote } : { samples: value });
    setBusy(false);
    if (!res.ok || !res.samples) {
      toast.error(res.ok ? 'Could not save the sample declaration' : res.error);
      return;
    }
    setSamples(res.samples);
    setNote(res.samples.note ?? '');
    onSaved();
  };

  return (
    <div className="mb-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="org-samples">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={LABEL}>Samples</p>
        {samples.canWrite ? (
          <div className="flex flex-wrap gap-1" role="group" aria-label="Sample declaration">
            {SAMPLES_VALUES.map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy}
                aria-pressed={samples.value === v}
                onClick={() => samples.value !== v && void save(v)}
                className={cn(CHIP, samples.value === v ? CHIP_ON : CHIP_REST)}
                data-testid={`org-samples-${v}`}
              >
                {SAMPLES_LABEL[v]}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-white/60" data-testid="org-samples-value">{samples.label}</p>
        )}
      </div>
      {samples.value === 'yes' && (
        <div className="mt-3">
          {samples.canWrite ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={2000}
                aria-label="Sample clearance note"
                placeholder="Who cleared it, when, and where the paperwork is"
                className="w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                data-testid="org-samples-note"
              />
              <button type="button" disabled={busy || note.trim() === (samples.note ?? '').trim()} onClick={() => void save('yes', note)} className={cn(CHIP, CHIP_REST, 'shrink-0')} data-testid="org-samples-save">
                Save note
              </button>
            </div>
          ) : null}
          <p className={cn('mt-2 text-[11px]', samples.cleared ? 'text-[#6DC6A4]' : 'text-[#c8a47a]')} data-testid="org-samples-cleared">
            {samples.cleared ? 'Clearance on file' : 'No clearance note or document yet'}
          </p>
        </div>
      )}
    </div>
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
