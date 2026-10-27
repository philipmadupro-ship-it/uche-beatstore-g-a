'use client';

/**
 * Split sheets of an org song (LABEL-28): who owns what share of the
 * composition and of the master, as versioned sheets that must add up to
 * exactly 100%.
 *
 *  - A DRAFT is a form: person, role, share per line, with the sum shown LIVE
 *    under it ("99.9999% — 0.0001% unassigned") and "Add remainder" to fill
 *    in what is missing. Circulate stays disabled, with the reason as its
 *    title, until the sheet is exactly 100. The arithmetic is
 *    lib/labelos/splits-form (integer units, never floats).
 *  - A circulated sheet is a record: read-only, with each line's signature,
 *    "Acknowledge" for the person on a line, "Upload signed PDF" for a rights
 *    writer, and "New version" to start the next draft. Circulating the new
 *    version replaces this one.
 *  - A member who only has their own line (D2) sees that line and nothing else
 *    of the sheet: the server sends no other name, share or total.
 *
 * Rules live in lib/labelos/splits and the routes; this file only draws them.
 * A member with no rights ability gets no section at all.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Trash2, Upload } from 'lucide-react';
import { Dropdown, type DropdownOption } from '@/components/ui/Dropdown';
import { DriftNotice } from '@/components/labelos/DriftNotice';
import { toast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';
import type { PartyView } from '@/lib/labelos/credits';
import { fetchParties } from '@/lib/labelos/credits-client';
import {
  acknowledgeSplitLine,
  circulateSplitSheet,
  discardSplitDraft,
  fetchSplits,
  saveSplitDraft,
  startSplitSheet,
  supersedeSplitSheet,
  uploadSignedSplitPdf,
  type SplitResult,
  type SplitsPayload,
} from '@/lib/labelos/splits-client';
import { formState, newRowKey, rowsToBody, sameRows, withRemainder, type FormRow } from '@/lib/labelos/splits-form';
import { defaultRoleFor, SPLIT_KIND_LABEL, SPLIT_KINDS, type SplitKind, type SplitLineView, type SplitSheetView } from '@/lib/labelos/splits';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:cursor-not-allowed disabled:opacity-40';
const FIELD = 'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none';

const STATUS_TONE: Record<string, string> = {
  draft: 'text-white/60',
  circulated: 'text-[#c8a47a]',
  signed: 'text-[#6DC6A4]',
  disputed: 'text-red-400',
  superseded: 'text-white/30',
};

/** The sheet shown for a kind: the draft in progress, else the one in force, else the latest. */
function currentSheet(sheets: SplitSheetView[], kind: SplitKind): SplitSheetView | null {
  const of = sheets.filter((s) => s.kind === kind);
  return of.find((s) => s.status === 'draft') ?? of.find((s) => s.status === 'circulated' || s.status === 'signed' || s.status === 'disputed') ?? of[0] ?? null;
}

export function OrgSplits({ orgId, trackId, orgSlug }: { orgId: string; trackId: string; orgSlug?: string }) {
  const [data, setData] = useState<SplitsPayload | null>(null);
  const [hidden, setHidden] = useState(false);
  const [kind, setKind] = useState<SplitKind>('composition');
  const [picked, setPicked] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchSplits(orgId, trackId);
    if (!res.ok) {
      // 403: no rights ability here. Anything else: say nothing rather than a broken box.
      setHidden(true);
      return;
    }
    setHidden(!res.schemaReady);
    setData(res);
  }, [orgId, trackId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount, as the sibling panels do
    void load();
  }, [load]);

  const replace = useCallback(
    (sheet: SplitSheetView | null) => {
      if (!sheet) {
        void load();
        return;
      }
      setData((d) => (d ? { ...d, sheets: d.sheets.some((s) => s.id === sheet.id) ? d.sheets.map((s) => (s.id === sheet.id ? sheet : s)) : [sheet, ...d.sheets] } : d));
    },
    [load],
  );

  const ofKind = useMemo(() => (data ? data.sheets.filter((s) => s.kind === kind).sort((a, b) => b.version - a.version) : []), [data, kind]);
  const sheet = data ? ofKind.find((s) => s.id === picked) ?? currentSheet(data.sheets, kind) : null;

  if (hidden) return null;
  if (!data) return <div className="h-8" aria-hidden="true" data-testid="org-splits-loading" />;

  const writer = data.me.canWrite;
  if (!writer && data.sheets.length === 0 && data.me.reach === 'own') return null;

  return (
    <section aria-labelledby="org-song-splits" data-testid="org-splits">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="org-song-splits" className={LABEL}>Splits</h2>
        <div role="tablist" aria-label="Split sheet kind" className="flex gap-1">
          {SPLIT_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => {
                setKind(k);
                setPicked(null);
              }}
              data-testid={`splits-tab-${k}`}
              className={cn(
                'rounded-lg border px-2.5 py-1 text-[11px] transition-colors',
                kind === k ? 'border-white/30 bg-white/[0.14] text-white' : 'border-white/10 text-white/40 hover:border-white/20 hover:text-white/80',
              )}
            >
              {SPLIT_KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>

      {ofKind.length > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="Versions" data-testid="splits-versions">
          {ofKind.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setPicked(s.id)}
              aria-pressed={sheet?.id === s.id}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] transition-colors',
                sheet?.id === s.id ? 'border-white/40 bg-white/10 text-white' : 'border-white/10 text-white/40 hover:border-white/20',
              )}
            >
              v{s.version}
              <span className={cn('font-mono uppercase tracking-[0.1em]', STATUS_TONE[s.status])}>{s.statusLabel.toLowerCase()}</span>
            </button>
          ))}
        </div>
      )}

      {sheet &&
        (data.contracts ?? []).flatMap((c) =>
          c.drift
            .filter((d) => d.sheetId === sheet.id)
            .map((d) => (
              <div key={`${c.contractId}-${d.sheetId}`} className="mb-3">
                <DriftNotice entry={d} against={`its contract “${c.title}”`} href={orgSlug ? `/o/${orgSlug}/rights/contracts/${c.contractId}` : undefined} />
              </div>
            )),
        )}

      {!sheet ? (
        <EmptyKind
          kind={kind}
          writer={writer}
          onStart={async () => {
            const res = await startSplitSheet(orgId, trackId, { kind });
            if (!res.ok) return void toast.error(res.error);
            setPicked(res.sheet.id);
            replace(res.sheet);
          }}
        />
      ) : sheet.status === 'draft' && sheet.can.edit ? (
        <DraftEditor
          key={sheet.id}
          orgId={orgId}
          trackId={trackId}
          sheet={sheet}
          kind={kind}
          roles={data.kinds.find((k) => k.key === kind)?.roles ?? []}
          onChanged={(s) => replace(s)}
          onGone={() => {
            setPicked(null);
            void load();
          }}
        />
      ) : (
        <SheetReadout
          key={sheet.id}
          orgId={orgId}
          trackId={trackId}
          sheet={sheet}
          writer={writer}
          onChanged={(s) => replace(s)}
          onNewVersion={(s) => {
            setPicked(s.id);
            replace(s);
          }}
        />
      )}
    </section>
  );
}

function EmptyKind({ kind, writer, onStart }: { kind: SplitKind; writer: boolean; onStart: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/40">No {SPLIT_KIND_LABEL[kind].toLowerCase()} split sheet yet.</p>
      {writer && (
        <button
          type="button"
          className={BTN}
          disabled={busy}
          data-testid="splits-start"
          onClick={async () => {
            setBusy(true);
            await onStart();
            setBusy(false);
          }}
        >
          <Plus size={10} className="mr-1 inline" aria-hidden="true" />Start {SPLIT_KIND_LABEL[kind].toLowerCase()} split
        </button>
      )}
    </div>
  );
}

function toRows(sheet: SplitSheetView): FormRow[] {
  return sheet.lines.map((l) => ({ key: l.id, partyId: l.partyId, role: l.role, share: l.share }));
}

function DraftEditor({
  orgId,
  trackId,
  sheet,
  kind,
  roles,
  onChanged,
  onGone,
}: {
  orgId: string;
  trackId: string;
  sheet: SplitSheetView;
  kind: SplitKind;
  roles: { key: string; label: string }[];
  onChanged: (s: SplitSheetView | null) => void;
  onGone: () => void;
}) {
  const [rows, setRows] = useState<FormRow[]>(() => toRows(sheet));
  const saved = useRef<FormRow[]>(toRows(sheet));
  const [parties, setParties] = useState<PartyView[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void fetchParties(orgId).then((res) => {
      if (live) setParties(res.ok ? res.parties : []);
    });
    return () => {
      live = false;
    };
  }, [orgId]);

  const state = formState(kind, rows);
  const dirty = !sameRows(rows, saved.current);
  const partyOptions: DropdownOption<string>[] = [{ value: '', label: 'Choose a person' }, ...(parties ?? []).map((p) => ({ value: p.id, label: p.displayName }))];
  const roleOptions: DropdownOption<string>[] = roles.map((r) => ({ value: r.key, label: r.label }));

  const patch = (key: string, change: Partial<FormRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...change } : r)));

  /** Save what is on screen; true when the server holds it. A draft may be incomplete, but every row must parse. */
  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!state.complete && rows.length > 0) {
      toast.error(state.blocker ?? 'Finish the lines first');
      return false;
    }
    const res = await saveSplitDraft(orgId, trackId, sheet.id, { lines: rowsToBody(rows) });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    saved.current = rows;
    onChanged(res.sheet);
    return true;
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const circulate = () =>
    run(async () => {
      if (!(await save())) return;
      const res: SplitResult<{ sheet: SplitSheetView; supersededId: string | null }> = await circulateSplitSheet(orgId, trackId, sheet.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.supersededId ? 'Circulated — it replaces the previous version' : 'Circulated for signature');
      onChanged(res.sheet);
      onGone();
    });

  const discard = () =>
    run(async () => {
      const res = await discardSplitDraft(orgId, trackId, sheet.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Draft discarded');
      onGone();
    });

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="splits-draft" data-version={sheet.version}>
      <p className="flex items-baseline gap-2 text-[11px] text-white/40">
        <span className="text-[13px] text-white/80">{SPLIT_KIND_LABEL[kind]} split · v{sheet.version}</span>
        <span className={cn('font-mono uppercase tracking-[0.1em]', STATUS_TONE.draft)}>Draft</span>
      </p>

      <ul className="space-y-2" aria-label="Split lines">
        {rows.map((r, i) => (
          <li key={r.key} className="grid grid-cols-[1fr_auto] items-center gap-2 sm:grid-cols-[1fr_9rem_6rem_auto]" data-testid="splits-row">
            <Dropdown<string> value={r.partyId} onChange={(v) => patch(r.key, { partyId: v })} options={partyOptions} aria-label={`Person, line ${i + 1}`} placeholder="Choose a person" />
            {roleOptions.length > 1 ? (
              <Dropdown<string> value={r.role} onChange={(v) => patch(r.key, { role: v })} options={roleOptions} aria-label={`Role, line ${i + 1}`} />
            ) : (
              <span className="text-[11px] text-white/40" aria-label={`Role, line ${i + 1}`}>{roleOptions[0]?.label}</span>
            )}
            <div className="relative">
              <input
                className={`${FIELD} pr-6 text-right tabular-nums`}
                inputMode="decimal"
                value={r.share}
                aria-label={`Share, line ${i + 1}`}
                aria-invalid={r.share.trim() !== '' && state.units[i] === null}
                placeholder="0"
                data-testid="splits-share"
                onChange={(e) => patch(r.key, { share: e.target.value })}
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-white/30">%</span>
            </div>
            <button type="button" aria-label={`Remove line ${i + 1}`} className="rounded-lg p-1.5 text-white/40 transition-colors hover:text-white" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={BTN}
          data-testid="splits-add-line"
          onClick={() => setRows((rs) => [...rs, { key: newRowKey(), partyId: '', role: defaultRoleFor(kind), share: '' }])}
        >
          <Plus size={10} className="mr-1 inline" aria-hidden="true" />Add line
        </button>
        <button type="button" className={BTN} disabled={state.remaining <= 0} onClick={() => setRows((rs) => withRemainder(kind, rs))} data-testid="splits-add-remainder">
          Add remainder
        </button>
      </div>

      <p
        role="status"
        aria-live="polite"
        data-testid="splits-total"
        data-tone={state.tone}
        className={cn('text-[13px] tabular-nums', state.tone === 'ok' ? 'text-[#6DC6A4]' : state.tone === 'over' ? 'text-red-400' : 'text-[#c8a47a]')}
      >
        {state.totalText}
        <span className="ml-2 text-[11px] text-white/40">{state.summary}</span>
      </p>

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={BTN} disabled={busy || !dirty} onClick={() =>
            void run(async () => {
              if (await save()) toast.success('Draft saved');
            })
          } data-testid="splits-save">
          Save draft
        </button>
        <button
          type="button"
          className={BTN}
          disabled={busy || !state.canCirculate}
          title={state.canCirculate ? 'Send for signature' : state.blocker ?? undefined}
          onClick={() => void circulate()}
          data-testid="splits-circulate"
        >
          Circulate
        </button>
        <button type="button" className={BTN} disabled={busy} onClick={() => void discard()} data-testid="splits-discard">
          Discard draft
        </button>
      </div>
      {!state.canCirculate && state.blocker && <p className="text-[11px] text-white/40" data-testid="splits-blocker">{state.blocker}</p>}
    </div>
  );
}

function SheetReadout({
  orgId,
  trackId,
  sheet,
  writer,
  onChanged,
  onNewVersion,
}: {
  orgId: string;
  trackId: string;
  sheet: SplitSheetView;
  writer: boolean;
  onChanged: (s: SplitSheetView | null) => void;
  onNewVersion: (s: SplitSheetView) => void;
}) {
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);
  const uploadFor = useRef<string | undefined>(undefined);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const acknowledge = (line: SplitLineView) =>
    act(async () => {
      const res = await acknowledgeSplitLine(orgId, trackId, sheet.id, line.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Acknowledged');
      onChanged(res.sheet);
    });

  const upload = (f: File) =>
    act(async () => {
      const res = await uploadSignedSplitPdf(orgId, trackId, sheet.id, f, uploadFor.current);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.complete ? 'Signed — every line is in' : 'Signature recorded');
      onChanged(res.sheet);
    });

  const newVersion = () =>
    act(async () => {
      const res = await supersedeSplitSheet(orgId, trackId, sheet.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Version ${res.sheet.version} started`);
      onNewVersion(res.sheet);
    });

  const canUpload = sheet.status === 'circulated' && writer && sheet.lines.some((l) => !l.signed);
  const full = sheet.total !== undefined;

  return (
    <div className="max-w-xl space-y-3 rounded-xl border border-white/10 bg-[#0D0D0A] p-3" data-testid="splits-sheet" data-status={sheet.status} data-version={sheet.version}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-white/40">
        <span className="text-[13px] text-white/80">{SPLIT_KIND_LABEL[sheet.kind as SplitKind] ?? sheet.kind} split · v{sheet.version}</span>
        <span className={cn('font-mono uppercase tracking-[0.1em]', STATUS_TONE[sheet.status])} data-testid="splits-status">{sheet.statusLabel}</span>
        {full && sheet.lineCount !== undefined && sheet.status !== 'superseded' && (
          <span data-testid="splits-progress">{sheet.signedCount} of {sheet.lineCount} signed</span>
        )}
      </p>

      <ul className="divide-y divide-white/10" aria-label="Split lines">
        {sheet.lines.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-testid="splits-line" data-line={l.id}>
            <span className="min-w-0 flex-1 text-[13px] text-white/80">
              {l.name}
              {l.mine && <span className="ml-1.5 text-[10px] text-white/30">you</span>}
              <span className="ml-2 text-[11px] text-white/40">{l.roleLabel}</span>
              {(l.legalName || l.ipi) && (
                <span className="block text-[11px] text-white/40">
                  {l.legalName}
                  {l.ipi ? ` · IPI ${l.ipi}` : ''}
                </span>
              )}
            </span>
            <span className="text-[13px] tabular-nums text-white/80">{l.share}%</span>
            {l.signed ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.1em] text-[#6DC6A4]" data-testid="splits-signed">
                <Check size={10} aria-hidden="true" />
                {l.signatureMethod === 'upload' ? 'signed PDF' : 'acknowledged'}
              </span>
            ) : sheet.status === 'circulated' ? (
              <span className="flex items-center gap-1.5">
                {l.can.acknowledge && (
                  <button type="button" className={BTN} disabled={busy} onClick={() => void acknowledge(l)} data-testid="splits-acknowledge">
                    <Check size={10} className="mr-1 inline" aria-hidden="true" />Acknowledge
                  </button>
                )}
                {l.can.uploadSigned && (
                  <button
                    type="button"
                    className={BTN}
                    disabled={busy}
                    onClick={() => {
                      uploadFor.current = l.id;
                      file.current?.click();
                    }}
                    data-testid="splits-upload-line"
                  >
                    <Upload size={10} className="mr-1 inline" aria-hidden="true" />Signed PDF
                  </button>
                )}
                {!l.can.acknowledge && !l.can.uploadSigned && <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-white/30">awaiting</span>}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {full && (
        <p className="text-[13px] tabular-nums text-white/60" data-testid="splits-total">
          {sheet.total}%
        </p>
      )}
      {sheet.note && <p className="text-[11px] text-white/40">{sheet.note}</p>}

      <div className="flex flex-wrap gap-1.5">
        {canUpload && (
          <button
            type="button"
            className={BTN}
            disabled={busy}
            onClick={() => {
              uploadFor.current = undefined;
              file.current?.click();
            }}
            data-testid="splits-upload"
          >
            <Upload size={10} className="mr-1 inline" aria-hidden="true" />Upload signed PDF
          </button>
        )}
        {sheet.can.supersede && (
          <button type="button" className={BTN} disabled={busy} onClick={() => void newVersion()} data-testid="splits-new-version">
            New version
          </button>
        )}
      </div>
      {sheet.status === 'superseded' && <p className="text-[11px] text-white/40">Replaced by a newer version. It stays on record.</p>}
      <input
        ref={file}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        aria-label="Signed split sheet PDF"
        data-testid="splits-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
