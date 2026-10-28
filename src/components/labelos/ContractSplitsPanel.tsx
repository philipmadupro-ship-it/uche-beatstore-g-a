'use client';

/**
 * A contract's split sheets (LABEL-59), on the contract page. Shows what the
 * contract states per sheet kind, the button that turns it into a DRAFT sheet
 * for the song, and the drift warning when the sheet in force no longer says
 * what a sent or signed contract says.
 *
 * Rules are server-side (`contract-splits.ts`, `…/contracts/[id]/splits`):
 * a draft is the only thing this ever writes, an existing draft is replaced
 * only after the person confirms here, and a reader without `rights.read` is
 * sent the yes/no of drift and no sheet numbers (D2). Draws nothing for a
 * contract type that states no split, or while the data is not set up.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from '@/hooks/useToast';
import { DriftNotice } from '@/components/labelos/DriftNotice';
import { useOrgShell } from '@/components/labelos/OrgShellContext';
import { fetchContractSplits, prefillSplitsFromContract, type ContractSplitsPayload, type KindPlanView, type PrefillResult } from '@/lib/labelos/contract-splits-client';
import { SPLIT_KIND_LABEL } from '@/lib/labelos/splits';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40';

const REASON_WORDS: Record<string, string> = {
  draft_exists: 'a draft already exists',
  field_missing: 'the contract states no share yet',
  no_song: 'no song is linked',
  no_holder: 'no party holds the share',
  over_100: 'the shares add up to more than 100%',
  invalid: 'the shares cannot be written as a sheet',
};

function resultSentence(results: PrefillResult[]): string {
  const parts = results.map((r) => {
    const k = SPLIT_KIND_LABEL[r.kind].toLowerCase();
    if (r.action === 'created') return `${k} draft created`;
    if (r.action === 'replaced') return `${k} draft updated`;
    return `${k} skipped (${REASON_WORDS[r.reason ?? ''] ?? 'nothing to fill'})`;
  });
  return parts.join(' · ');
}

export function ContractSplitsPanel({ orgId, contractId, trackId, version }: { orgId: string; contractId: string; trackId: string | null; version: number }) {
  const shell = useOrgShell();
  const [data, setData] = useState<ContractSplitsPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchContractSplits(orgId, contractId);
    setData(res.ok && res.schemaReady ? res : null);
  }, [orgId, contractId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount and when the contract's version changes, as the sibling panels do
    void load();
  }, [load, version]);

  if (!data || !data.applicable) return null;

  const songHref = shell && trackId ? `/o/${shell.org.slug}/songs/${trackId}` : undefined;
  const fillable = data.plans.filter((p): p is Extract<KindPlanView, { ok: true }> => p.ok);
  const hasDraft = fillable.some((p) => data.drafts?.[p.kind]);

  const run = async (replace: boolean) => {
    setBusy(true);
    const res = await prefillSplitsFromContract(orgId, contractId, replace ? { replace_draft: true } : {});
    setBusy(false);
    setConfirmReplace(false);
    if (!res.ok) {
      // Ask before replacing only when the server says a draft is what stopped it (a void contract is also a 409).
      if (res.results?.some((r) => r.reason === 'draft_exists')) setConfirmReplace(true);
      return void toast.error(res.error);
    }
    toast.success(resultSentence(res.results));
    // A kind that was skipped because its draft exists can still be refreshed, after a second, explicit click.
    if (res.results.some((r) => r.reason === 'draft_exists')) setConfirmReplace(true);
    void load();
  };

  return (
    <section aria-labelledby="contract-splits" className="space-y-3" data-testid="contract-splits">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="contract-splits" className={LABEL}>Split sheets</h2>
        {songHref && <Link href={songHref} className="text-[10px] text-white/50 underline" data-testid="contract-splits-song">Open the song’s splits</Link>}
      </div>

      {data.drift.map((d) => (
        <DriftNotice key={d.sheetId} entry={d} against="this contract" href={songHref} />
      ))}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.plans.map((p) => (
          <div key={p.kind} className="min-w-0 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid={`contract-split-plan-${p.kind}`}>
            <p className="text-[11px] text-white/80">{SPLIT_KIND_LABEL[p.kind]}</p>
            {p.ok ? (
              <>
                <ul className="mt-2 space-y-1 text-[11px] text-white/60">
                  {p.lines.map((l) => (
                    <li key={`${l.partyId}-${l.role}`} className="flex justify-between gap-3">
                      <span className="min-w-0 truncate">{l.name} · {l.roleLabel}</span>
                      <span className="shrink-0 font-mono text-white/80">{l.share}%</span>
                    </li>
                  ))}
                </ul>
                {p.incomplete && <p className="mt-2 text-[10px] text-white/40">The contract does not account for the whole 100%. Add the rest on the sheet before it is circulated.</p>}
              </>
            ) : (
              <p className="mt-2 text-[11px] text-white/40" data-testid={`contract-split-skip-${p.kind}`}>{p.message}</p>
            )}
          </div>
        ))}
      </div>

      {data.canPrefill && fillable.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {!confirmReplace && (
            <button type="button" className={BTN} disabled={busy} onClick={() => void run(false)} data-testid="contract-splits-prefill">
              {busy ? 'Working…' : hasDraft ? 'Pre-fill from this contract' : 'Create draft split sheet'}
            </button>
          )}
          {confirmReplace && (
            <>
              <span className="text-[11px] text-white/60" data-testid="contract-splits-confirm">A draft already exists. Replace its lines with the contract’s?</span>
              <button type="button" className={BTN} disabled={busy} onClick={() => void run(true)} data-testid="contract-splits-replace">Replace the draft’s lines</button>
              <button type="button" className={BTN} disabled={busy} onClick={() => setConfirmReplace(false)}>Keep my draft</button>
            </>
          )}
          <span className="text-[10px] text-white/40">Only ever a draft. A circulated or signed sheet stays as it is.</span>
        </div>
      )}
    </section>
  );
}
