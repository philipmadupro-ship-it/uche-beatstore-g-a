'use client';

/**
 * "Contract draft" — the contract a buyer of this tier would get, shown under
 * the tier in the License Builder (LICENSE-05). Built on the server by the same
 * function the webhook uses (GET/POST /api/licenses/[id]/contract-draft), from
 * the SAVED tier and the producer's wording (the editor's unsaved text when the
 * page passes it). Collapsed by default. Problems come first, then the text in a
 * bounded box with its own scroll; the generated Schedule of Terms is part of the
 * text and is not editable anywhere.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Pencil } from 'lucide-react';
import type { TierDraftView } from '@/lib/contracts/license-draft';

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; draft: TierDraftView };

export function LicenseContractDraft({
  tierId, template, dirty = false,
}: {
  tierId: string;
  /** the wording as currently edited on the page; null/undefined = the saved wording */
  template?: string | null;
  /** the tier has unsaved edits: the draft shows the saved tier */
  dirty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setState((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
    // Typing in the editor re-drafts shortly after the last key.
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/licenses/${encodeURIComponent(tierId)}/contract-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(template === undefined || template === null ? {} : { template }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
        if (!cancelled) setState({ kind: 'ready', draft: j.draft as TierDraftView });
      } catch (err) {
        if (!cancelled) setState({ kind: 'error', message: err instanceof Error ? err.message : 'Could not build the draft' });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open, tierId, template]);

  const draft = state.kind === 'ready' ? state.draft : null;
  const problems = draft
    ? [...draft.verification.missing.map((m) => `Missing from the contract: ${m}`), ...draft.alerts]
    : [];

  return (
    <div className="rounded-xl border border-white/10" data-testid="license-contract-draft">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Contract draft"
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">Contract</span>
        <span className="flex items-center gap-2 whitespace-nowrap text-[11px] text-white/60">
          Review draft
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </span>
      </button>
      {open && (
        <div className="min-w-0 space-y-3 border-t border-white/10 px-3 py-3">
          <p className="text-[10px] leading-relaxed text-white/40">
            What a buyer of this tier receives, with a sample buyer and price. Edit the wording in License Contract; the Schedule of Terms at the end is generated from this tier and governs.
          </p>
          {dirty && (
            <p className="text-[11px] leading-snug text-[#c8a47a]" data-testid="license-contract-draft-dirty">
              This tier has unsaved changes. Save it to update the draft.
            </p>
          )}
          {state.kind === 'loading' && <p className="text-[11px] text-white/40">Building the draft&hellip;</p>}
          {state.kind === 'error' && <p role="alert" className="text-[11px] text-[#ffb7a8]">{state.message}</p>}
          {draft && (
            <>
              <div data-testid="license-contract-draft-status">
                {problems.length === 0 && draft.verification.ok ? (
                  <p className="text-[11px] text-[#6DC6A4]">The contract states this tier&rsquo;s terms exactly.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {problems.map((p, i) => (
                      <li key={`${i}-${p.slice(0, 24)}`} className="break-words text-[11px] leading-snug text-[#c8a47a]">{p}</li>
                    ))}
                  </ul>
                )}
              </div>
              <pre
                data-testid="license-contract-draft-text"
                tabIndex={0}
                aria-label="Contract draft text"
                className="max-h-72 min-w-0 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-white/10 bg-[#090907] p-3 font-sans text-[11px] leading-relaxed text-white/80"
              >
                {draft.markdown}
              </pre>
              <div className="flex flex-wrap items-center gap-2">
                <a
                  href={`/api/licenses/${encodeURIComponent(tierId)}/contract-draft?format=pdf`}
                  download
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10]"
                >
                  <Download size={12} /> Download PDF draft
                </a>
                <a
                  href="/store-editor#license-template"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-transparent px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-white/60 transition-colors hover:border-white/20 hover:text-white/80"
                >
                  <Pencil size={12} /> Edit wording
                </a>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
