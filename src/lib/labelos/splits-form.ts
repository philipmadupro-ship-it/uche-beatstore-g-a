/**
 * The split sheet form's arithmetic (LABEL-28), pure so the screen cannot
 * quietly disagree with the server: text in, integer units out, never a float.
 *
 * A row holds what the person typed. `formState` turns the rows into the
 * live sum shown under the table ("99.9999% — 0.0001% unassigned") and says
 * whether the sheet could circulate; `withRemainder` is "Add remainder".
 * The server and the database re-check everything: this only keeps the
 * screen honest while the person types.
 */
import { defaultRoleFor, formatShare, FULL_SHARE, parseShare, validateSheet, type SplitKind, type SplitLineInput } from './splits';

export type FormRow = { key: string; partyId: string; role: string; share: string };

export type FormState = {
  /** Per row: its units, or null when the text is not a share (blank, 5 decimals, "abc", 0). */
  units: (number | null)[];
  /** Sum of the rows that parse, in units. */
  total: number;
  /** FULL_SHARE − total (negative = over). */
  remaining: number;
  /** "99.9999%", exact. */
  totalText: string;
  /** One sentence for under the table: what is missing / too much / fine. */
  summary: string;
  tone: 'ok' | 'short' | 'over';
  /** Every row has a party, a share that parses and a role of the kind — ready to SAVE (an incomplete draft is fine). */
  complete: boolean;
  /** Could circulate: complete AND validateSheet passes (exactly 100, no duplicates). */
  canCirculate: boolean;
  /** The first thing stopping circulation, for the disabled button's tooltip. */
  blocker: string | null;
};

export function rowUnits(text: string): number | null {
  const units = parseShare(text);
  return units === null || units <= 0 ? null : units;
}

export function formState(kind: SplitKind, rows: readonly FormRow[]): FormState {
  const units = rows.map((r) => rowUnits(r.share));
  const total = units.reduce<number>((sum, u) => sum + (u ?? 0), 0);
  const remaining = FULL_SHARE - total;
  const complete = rows.length > 0 && rows.every((r, i) => !!r.partyId && units[i] !== null);
  const lines: SplitLineInput[] = rows.map((r, i) => ({ partyId: r.partyId, role: r.role, units: units[i] ?? 0 }));
  const check = validateSheet(kind, lines);
  const canCirculate = complete && check.ok;

  let tone: FormState['tone'] = 'ok';
  let summary = 'Adds up to 100%.';
  if (remaining > 0) {
    tone = 'short';
    summary = `${formatShare(remaining)}% unassigned.`;
  } else if (remaining < 0) {
    tone = 'over';
    summary = `${formatShare(-remaining)}% too much.`;
  }

  let blocker: string | null = null;
  if (rows.length === 0) blocker = 'Add at least one line.';
  else if (rows.some((r) => !r.partyId)) blocker = 'Every line needs a person.';
  else if (units.some((u) => u === null)) blocker = 'Every line needs a share: more than 0, up to four decimals.';
  else if (!check.ok) blocker = check.issues[0].message;

  return { units, total, remaining, totalText: `${formatShare(total)}%`, summary, tone, complete, canCirculate, blocker };
}

let counter = 0;
export const newRowKey = (): string => `row-${(counter += 1)}`;

/**
 * "Add remainder": give the missing share to the first row with no share
 * typed, or add a row for it. Returns the rows unchanged when nothing is
 * missing (full or over) — the button is disabled then.
 */
export function withRemainder(kind: SplitKind, rows: readonly FormRow[]): FormRow[] {
  const state = formState(kind, rows);
  if (state.remaining <= 0) return [...rows];
  const text = formatShare(state.remaining);
  const blank = rows.findIndex((r) => rowUnits(r.share) === null);
  if (blank >= 0) return rows.map((r, i) => (i === blank ? { ...r, share: text } : r));
  return [...rows, { key: newRowKey(), partyId: '', role: defaultRoleFor(kind), share: text }];
}

/** The body the routes take: every row as { party_id, role, share } (the share as typed, parsed by the server). */
export function rowsToBody(rows: readonly FormRow[]): { party_id: string; role: string; share: string }[] {
  return rows.map((r) => ({ party_id: r.partyId, role: r.role, share: r.share.trim() }));
}

/** Two rows' content, ignoring keys: has the person changed anything since the last save? */
export function sameRows(a: readonly FormRow[], b: readonly FormRow[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((r, i) => r.partyId === b[i].partyId && r.role === b[i].role && rowUnits(r.share) === rowUnits(b[i].share) && (rowUnits(r.share) !== null || r.share.trim() === b[i].share.trim()));
}
