'use client';

/**
 * The approval control of an org song or release (LABEL-30, 09 §3.3): a status
 * chip and a small control per gate. A song is asked for the `legal` gate only;
 * a release for all five (master, artwork, legal, marketing, metadata) — the
 * release page mounts it with `subject` so the people who hold those gates can
 * ask and answer without leaving it (`onChanged` lets the page refresh its
 * readiness).
 *
 * Words are Frame.io's: "Approved" and "Changes requested", each with a note.
 * An approval whose song has moved on reads "Stale — changed since approval"
 * with what changed; that state is derived by the server on every read, never
 * stored, so the control only draws what it was sent. Every rule (who may ask,
 * who may answer, nobody approving their own request) is the server's; the
 * buttons here are shown only to someone it would let press them, and the
 * server's own words are the error toast.
 *
 * Inline form, not a popover: the approver picker is a `Dropdown`, which
 * portals to <body>, and choosing in it is an outside click to a Popover.
 */
import { useCallback, useEffect, useState } from 'react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { decideApproval, fetchApprovals, requestApproval, type ApprovalSubject, type ApprovalsPayload, type GateStateView } from '@/lib/labelos/approvals-client';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';

const TONE: Record<GateStateView['chip']['tone'], string> = {
  neutral: 'border-white/10 text-white/60',
  waiting: 'border-white/20 text-white/80',
  good: 'border-[#6DC6A4]/40 text-[#6DC6A4]',
  warn: 'border-[#c8a47a]/40 text-[#c8a47a]',
};

const PART_WORDS: Record<string, string> = { songs: 'splits or credits', artwork: 'the artwork', items: 'the tracklist', release: 'the release details' };

export const changedText = (parts: readonly string[]): string => {
  const words = parts.map((p) => PART_WORDS[p] ?? p);
  return words.length === 0 ? 'what was approved' : words.join(' and ');
};

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function OrgApprovals({ orgId, trackId, subject: given, onChanged }: { orgId: string; trackId?: string; subject?: ApprovalSubject; onChanged?: () => void }) {
  const [data, setData] = useState<ApprovalsPayload | null>(null);
  const [hidden, setHidden] = useState(false);
  const subject: ApprovalSubject = given ?? { kind: 'song', id: trackId ?? '' };
  const { kind, id } = subject;

  // A different song or release remounts this (the caller keys it by subject).
  useEffect(() => {
    let live = true;
    void fetchApprovals(orgId, { kind, id }).then((res) => {
      if (!live) return;
      if (!res.ok || !res.schemaReady || res.gates.length === 0) setHidden(true);
      else setData(res);
    });
    return () => {
      live = false;
    };
  }, [orgId, kind, id]);

  /** Look again: the facts moved under an approver, so the screen they were deciding from is out of date. */
  const reload = useCallback(() => {
    void fetchApprovals(orgId, { kind, id }).then((res) => {
      if (res.ok && res.schemaReady && res.gates.length > 0) setData(res);
    });
  }, [orgId, kind, id]);

  if (hidden) return null;
  if (!data) return <div className="h-8" aria-hidden="true" data-testid="org-approvals-loading" />;

  return (
    <section aria-labelledby="org-song-approvals" data-testid="org-approvals">
      <h2 id="org-song-approvals" className={`${LABEL} mb-3`}>{kind === 'release' ? 'Approvals' : 'Approval'}</h2>
      <ul className="space-y-3">
        {data.gates.map((g) => (
          <GateRow
            key={g.gate}
            orgId={orgId}
            subject={subject}
            gate={g}
            onChange={(next) => {
              setData(next);
              onChanged?.();
            }}
            onStale={reload}
          />
        ))}
      </ul>
    </section>
  );
}

function GateRow({ orgId, subject, gate, onChange, onStale }: { orgId: string; subject: ApprovalSubject; gate: GateStateView; onChange: (next: ApprovalsPayload) => void; onStale: () => void }) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<null | 'changes_requested'>(null);
  const [approver, setApprover] = useState('');
  const [note, setNote] = useState('');
  const [withTask, setWithTask] = useState(true);

  const done = useCallback(
    (res: { ok: true } & ApprovalsPayload, message: string) => {
      onChange(res);
      setAsking(false);
      setDeciding(null);
      setNote('');
      setApprover('');
      toast.success(message);
    },
    [onChange],
  );

  const ask = async () => {
    setBusy(true);
    const res = await requestApproval(orgId, { subject, gate: gate.gate, approverId: approver, note, withTask: legal && gate.canTask === true && withTask });
    setBusy(false);
    if (!res.ok) return void toast.error(res.error);
    done(res, legal ? 'Sent to legal' : 'Approval requested');
  };
  const decide = async (decision: 'approved' | 'changes_requested') => {
    setBusy(true);
    const res = await decideApproval(orgId, { subject, gate: gate.gate, decision, note, seen: decision === 'approved' ? gate.snapshotKey : undefined });
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      // 409: what the approver was looking at changed. Show them the new state before they try again.
      if (res.status === 409) onStale();
      return;
    }
    done(res, decision === 'approved' ? 'Approved' : 'Changes requested');
  };

  const options: DropdownOption<string>[] = gate.approvers.map((a) => ({ value: a.userId, label: a.name }));
  const legal = gate.gate === 'legal';
  const open = gate.status === 'requested';
  const showAsk = gate.canRequest && !open && options.length > 0;

  return (
    <li className="rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid={`org-approval-${gate.gate}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[13px] text-white">{gate.label}</span>
        <span
          className={cn('rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.1em]', TONE[gate.chip.tone])}
          data-testid={`org-approval-chip-${gate.gate}`}
          data-stale={gate.stale ? 'true' : 'false'}
        >
          {gate.chip.label}
        </span>
      </div>

      {gate.stale && (
        <p className="mt-2 text-[11px] text-[#c8a47a]" data-testid="org-approval-stale">
          {changedText(gate.changed)} changed after {gate.decision?.by ?? 'someone'} approved it on {gate.decision ? when(gate.decision.at) : 'an earlier date'}. Ask again to renew it.
        </p>
      )}
      {gate.decision && !gate.stale && gate.status !== 'requested' && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="org-approval-decision">
          {gate.decision.decision === 'approved' ? 'Approved' : 'Changes requested'} by {gate.decision.by ?? 'a member'} · {when(gate.decision.at)}
          {gate.decision.note ? <span className="mt-1 block text-white/80">“{gate.decision.note}”</span> : null}
        </p>
      )}
      {open && gate.pending && (
        <p className="mt-2 text-[11px] text-white/60" data-testid="org-approval-pending">
          Asked of {gate.pending.approver ?? 'a member'} by {gate.pending.by ?? 'a member'} · {when(gate.pending.at)}
          {gate.pending.note ? <span className="mt-1 block text-white/80">“{gate.pending.note}”</span> : null}
        </p>
      )}

      {gate.canDecide && (
        <div className="mt-3 space-y-2">
          {deciding && (
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="What needs to change?"
              aria-label="What needs to change"
              className={FIELD}
              data-testid="org-approval-note"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!deciding && (
              <button
                type="button"
                className={BTN}
                disabled={busy || gate.selfApprovalBlocked || (gate.status === 'approved' && !gate.stale)}
                title={gate.selfApprovalBlocked ? 'You cannot approve a request you made yourself' : undefined}
                onClick={() => void decide('approved')}
                data-testid="org-approval-approve"
              >
                Approve
              </button>
            )}
            {deciding ? (
              <>
                <button type="button" className={BTN} disabled={busy || note.trim().length === 0} onClick={() => void decide('changes_requested')} data-testid="org-approval-send-changes">
                  Send changes
                </button>
                <button type="button" className={BTN} disabled={busy} onClick={() => { setDeciding(null); setNote(''); }}>Cancel</button>
              </>
            ) : (
              <button type="button" className={BTN} disabled={busy} onClick={() => setDeciding('changes_requested')} data-testid="org-approval-changes">
                Request changes
              </button>
            )}
          </div>
          {gate.selfApprovalBlocked && !deciding && <p className="text-[11px] text-white/40">Someone else holding this gate has to approve a request you made.</p>}
        </div>
      )}

      {showAsk && (
        <div className="mt-3">
          {asking ? (
            <div className="space-y-2" data-testid="org-approval-ask-form">
              <Dropdown<string> value={approver} onChange={setApprover} options={options} aria-label="Who should approve" placeholder="Choose who to ask" />
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} placeholder="A note for them (optional)" aria-label="A note for the approver" className={FIELD} />
              {legal && gate.canTask && (
                <label className="flex items-center gap-2 text-[11px] text-white/60">
                  <input type="checkbox" checked={withTask} onChange={(e) => setWithTask(e.target.checked)} data-testid="org-approval-with-task" />
                  Also give them a task
                </label>
              )}
              <div className="flex gap-2">
                <button type="button" className={BTN} disabled={busy || !approver} onClick={() => void ask()} data-testid="org-approval-send-request">{legal ? 'Send to legal' : 'Send request'}</button>
                <button type="button" className={BTN} disabled={busy} onClick={() => { setAsking(false); setNote(''); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" className={BTN} onClick={() => setAsking(true)} data-testid="org-approval-ask">
              {legal ? 'Send to legal' : gate.status === 'none' ? 'Ask for approval' : 'Ask again'}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
