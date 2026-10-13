'use client';

/**
 * Who is credited on an org song (LABEL-27) — the producer's credits strip
 * (`groupCredits`: one pill per person, roles joined) with what the org adds:
 * a STATUS on the pill (proposed / disputed; a confirmed credit is quiet), the
 * rights-holder PARTY behind it, and the actions a member may take — Confirm
 * or Dispute for `rights.write` and for the credited person, Propose for
 * `rights.write` (anyone) and for a member with an own line (themselves only,
 * the server enforces it; the form simply never offers another name).
 *
 * Legal name and IPI show only when the server sent them (`rights.read`, or
 * the credit is the viewer's own). A member with no credits ability gets no
 * section at all. The rules are lib/labelos/credits + credit-strip; this file
 * only draws them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Check, Link2, Plus } from 'lucide-react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { Popover } from '@/components/ui/Popover';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import { creditRoleLabel } from '@/lib/labelos/credit-roles';
import { personSummary, roleGroups, stripPeople, type StripPerson } from '@/lib/labelos/credit-strip';
import { CREDIT_STATUS_LABEL, type CreditView, type PartyView } from '@/lib/labelos/credits';
import { decideCredit, fetchCredits, fetchParties, proposeCredit, type CreditsPayload } from '@/lib/labelos/credits-client';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';

const STATUS_TONE: Record<string, string> = {
  proposed: 'text-[#c8a47a]',
  disputed: 'text-red-400',
  confirmed: 'text-white/40',
};

export function OrgCredits({ orgId, trackId }: { orgId: string; trackId: string }) {
  const [data, setData] = useState<CreditsPayload | null>(null);
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchCredits(orgId, trackId);
    if (!res.ok) {
      // 403: this member has no credits ability here. Anything else: say nothing rather than a broken box.
      setHidden(true);
      return;
    }
    setHidden(!res.schemaReady);
    setData(res);
  }, [orgId, trackId]);

  // A different song remounts this (the caller keys it by track), so there is nothing to reset here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, as the sibling panels do
    void load();
  }, [load]);

  const replace = (credit: CreditView) =>
    setData((d) => (d ? { ...d, credits: d.credits.map((c) => (c.id === credit.id ? credit : c)) } : d));

  if (hidden) return null;
  if (!data) return <div className="h-8" aria-hidden="true" data-testid="org-credits-loading" />;

  const people = stripPeople(data.credits);
  return (
    <section aria-labelledby="org-song-credits" data-testid="org-credits">
      <h2 id="org-song-credits" className={`${LABEL} mb-3`}>Credits</h2>
      <div className="flex flex-wrap items-center gap-1.5">
        {people.length === 0 && !data.me.canPropose && <p className="text-[11px] text-white/40">No credits you can see yet.</p>}
        {people.map((p) => (
          <PersonPill key={p.key} orgId={orgId} trackId={trackId} person={p} onChanged={replace} />
        ))}
        {data.me.canPropose && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            aria-expanded={adding}
            aria-label={data.me.canWrite ? 'Propose a credit' : 'Credit me'}
            data-testid="credit-add"
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors',
              adding ? 'border-white/40 bg-white/10 text-white' : 'border-dashed border-white/15 text-white/40 hover:border-white/30 hover:text-white',
            )}
          >
            <Plus size={10} />
            {data.me.canWrite ? 'Propose credit' : 'Credit me'}
          </button>
        )}
      </div>
      {adding && data.me.canPropose && (
        <AddCreditForm
          orgId={orgId}
          trackId={trackId}
          payload={data}
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {people.length === 0 && data.me.canPropose && <p className="mt-2 text-[11px] text-white/40">No credits yet.</p>}
    </section>
  );
}

function PersonPill({ orgId, trackId, person, onChanged }: { orgId: string; trackId: string; person: StripPerson; onChanged: (c: CreditView) => void }) {
  const [open, setOpen] = useState(false);
  const roles = person.roles.map(creditRoleLabel).join(', ');
  return (
    <Popover
      width={320}
      open={open}
      onOpenChange={setOpen}
      initialFocus
      label={`Credits for ${person.name}`}
      trigger={({ open: isOpen, toggle, ref }) => (
        <button
          type="button"
          ref={ref as (el: HTMLButtonElement | null) => void}
          onClick={toggle}
          aria-expanded={isOpen}
          title={personSummary(person, creditRoleLabel)}
          data-testid="credit-person"
          data-status={person.status}
          className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.06] py-1 pl-2.5 pr-2.5 text-[10px] font-medium text-white/70 transition-colors hover:border-white/20 hover:text-white"
        >
          <span>{person.name}</span>
          <span className="text-white/30">· {roles}</span>
          {person.status !== 'confirmed' && (
            <span className={cn('font-mono uppercase tracking-[0.1em]', STATUS_TONE[person.status])} data-testid="credit-status">
              {CREDIT_STATUS_LABEL[person.status].toLowerCase()}
            </span>
          )}
          {person.hasParty && <Link2 size={9} className="text-white/40" aria-label="Linked to a rights holder" />}
        </button>
      )}
    >
      <div className="space-y-3 p-3">
        {person.credits.map((c) => (
          <CreditRowView key={c.id} orgId={orgId} trackId={trackId} credit={c} onChanged={onChanged} />
        ))}
      </div>
    </Popover>
  );
}

function PartyLine({ party }: { party: PartyView }) {
  const legal = party.legal;
  return (
    <p className="text-[11px] text-white/40" data-testid="credit-party">
      Rights holder: {party.displayName}
      {legal?.legalName ? ` (${legal.legalName})` : ''}
      {legal?.ipi ? ` · IPI ${legal.ipi}` : ''}
      {legal?.pro ? ` · ${legal.pro}` : ''}
    </p>
  );
}

function CreditRowView({ orgId, trackId, credit, onChanged }: { orgId: string; trackId: string; credit: CreditView; onChanged: (c: CreditView) => void }) {
  const [busy, setBusy] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');

  const decide = async (action: 'confirm' | 'dispute') => {
    setBusy(true);
    const res = await decideCredit(orgId, trackId, credit.id, action, action === 'dispute' ? note.trim() || undefined : undefined);
    setBusy(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setDisputing(false);
    setNote('');
    onChanged(res.credit);
    toast.success(action === 'confirm' ? 'Credit confirmed' : 'Credit disputed');
  };

  return (
    <div className="space-y-1.5" data-testid="credit-row" data-credit={credit.id}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[13px] text-white/80">
        <span>{credit.roleLabel}</span>
        {credit.roleDetail && <span className="text-[11px] text-white/40">{credit.roleDetail}</span>}
        <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-white/30">{credit.scope === 'composition' ? 'song' : 'recording'}</span>
        <span className={cn('text-[10px] font-mono uppercase tracking-[0.1em]', STATUS_TONE[credit.status])}>{CREDIT_STATUS_LABEL[credit.status]}</span>
      </p>
      {credit.party && <PartyLine party={credit.party} />}
      {credit.status === 'disputed' && credit.disputeNote && <p className="text-[11px] text-red-400">“{credit.disputeNote}”</p>}
      {(credit.can.confirm || credit.can.dispute) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {credit.can.confirm && (
            <button type="button" className={BTN} disabled={busy} onClick={() => void decide('confirm')} data-testid="credit-confirm">
              <Check size={10} className="mr-1 inline" aria-hidden="true" />Confirm
            </button>
          )}
          {credit.can.dispute && !disputing && (
            <button type="button" className={BTN} disabled={busy} onClick={() => setDisputing(true)} data-testid="credit-dispute">Dispute</button>
          )}
        </div>
      )}
      {disputing && (
        <div className="space-y-1.5">
          <input
            className={FIELD}
            value={note}
            maxLength={1000}
            placeholder="What is wrong? (optional)"
            aria-label="Why you dispute this credit"
            onChange={(e) => setNote(e.target.value)}
            data-testid="credit-dispute-note"
          />
          <div className="flex gap-1.5">
            <button type="button" className={BTN} disabled={busy} onClick={() => void decide('dispute')} data-testid="credit-dispute-send">Send dispute</button>
            <button type="button" className={BTN} disabled={busy} onClick={() => setDisputing(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Inline, not a popover: its role and party pickers are `Dropdown`s, which
 * portal to <body>, and a click inside a portaled menu is an "outside click" to
 * a Popover — picking an option closed the form under the user's hand.
 */
function AddCreditForm({ orgId, trackId, payload, onAdded, onClose }: { orgId: string; trackId: string; payload: CreditsPayload; onAdded: () => void; onClose: () => void }) {
  const writer = payload.me.canWrite;
  const [role, setRole] = useState('');
  const [detail, setDetail] = useState('');
  const [name, setName] = useState('');
  const [partyId, setPartyId] = useState('');
  const [parties, setParties] = useState<PartyView[] | null>(null);
  const [saving, setSaving] = useState(false);

  const groups = roleGroups(payload.roles);
  const options: DropdownOption<string>[] = groups.flatMap((g) =>
    g.roles.map((r, i) => ({ value: r.key, label: r.label, hint: i === 0 ? g.label : undefined, separator: i === 0 && g.scope === 'recording' })),
  );
  const chosen = payload.roles.find((r) => r.key === role);

  useEffect(() => {
    if (!writer) return;
    let live = true;
    void fetchParties(orgId).then((res) => {
      if (live) setParties(res.ok ? res.parties : []);
    });
    return () => {
      live = false;
    };
  }, [writer, orgId]);

  const canSubmit = !!role && (!writer || !!partyId || !!name.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    const res = await proposeCredit(orgId, trackId, {
      role,
      ...(detail.trim() ? { role_detail: detail.trim() } : {}),
      ...(writer ? (partyId ? { party_id: partyId } : { name: name.trim() }) : {}),
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success('Credit proposed');
    onAdded();
  };

  return (
    <form onSubmit={submit} className="mt-3 max-w-sm space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" aria-label="Propose a credit" data-testid="credit-form">
      {writer ? (
        <>
          <div>
            <p className={`${LABEL} mb-1`}>Rights holder</p>
            <Dropdown<string>
              value={partyId}
              onChange={setPartyId}
              aria-label="Rights holder"
              placeholder="Pick a party"
              options={[{ value: '', label: 'Just a name' }, ...(parties ?? []).map((p) => ({ value: p.id, label: p.displayName }))]}
            />
          </div>
          {!partyId && (
            <div>
              <label htmlFor="credit-name" className={`${LABEL} mb-1 block`}>Name</label>
              <input id="credit-name" className={FIELD} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nova Okafor" />
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] text-white/60">This adds a credit for you. It stays proposed until someone confirms it.</p>
      )}
      <div>
        <p className={`${LABEL} mb-1`}>Role</p>
        <Dropdown<string> value={role} onChange={setRole} options={options} aria-label="Credit role" placeholder="Choose a role" />
      </div>
      {chosen?.detail && (
        <div>
          <label htmlFor="credit-detail" className={`${LABEL} mb-1 block`}>{chosen.detail}</label>
          <input id="credit-detail" className={FIELD} value={detail} maxLength={200} onChange={(e) => setDetail(e.target.value)} placeholder="e.g. Rhodes" />
        </div>
      )}
      <div className="flex gap-1.5">
        <button type="submit" disabled={saving || !canSubmit} className={BTN} data-testid="credit-submit">
          {saving ? 'Proposing…' : writer ? 'Propose credit' : 'Credit me'}
        </button>
        <button type="button" className={BTN} onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}
