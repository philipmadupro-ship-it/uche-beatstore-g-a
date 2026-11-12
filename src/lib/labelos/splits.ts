/**
 * Split sheets (LABEL-28, 05 §3, 06 §2.3/§2.6): who owns what share of a
 * song's composition or master, as an immutable, versioned document.
 * Pure — the routes load and write; the database trigger (migration 155)
 * holds the same two rules this module checks first, so a bug here cannot
 * circulate a sheet that does not add up:
 *
 *   - a sheet leaves `draft` only when its lines sum to EXACTLY 100.0000;
 *   - from `circulated` on its lines (parties, roles, shares) never change.
 *
 * MONEY MATHS IS INTEGER. A share is held as `units` = ten-thousandths of a
 * percent (1 unit = 0.0001 %, 100 % = 1_000_000 units), the precision of
 * the `numeric(7,4)` column. Floats never touch a share: 33.3333 × 3 is
 * 99.9999 here and in the database, and 0.1 + 0.2 never comes up. Text
 * is parsed digit by digit, not through `Number`.
 *
 * Composition and master sheets are validated separately: each kind has its
 * own set of roles, and its own total.
 */
import { canWriteRights, creditReach, mayReadLegal, type CreditActor } from './credits';

export const SPLIT_KINDS = ['composition', 'master'] as const;
export type SplitKind = (typeof SPLIT_KINDS)[number];

export const SPLIT_STATUSES = ['draft', 'circulated', 'signed', 'superseded', 'disputed'] as const;
export type SplitStatus = (typeof SPLIT_STATUSES)[number];

export const SPLIT_ROLES = ['writer', 'composer', 'writer_composer', 'publisher', 'master_owner'] as const;
export type SplitRole = (typeof SPLIT_ROLES)[number];

export const SPLIT_SIGNATURE_METHODS = ['upload', 'acknowledged'] as const;
export type SplitSignatureMethod = (typeof SPLIT_SIGNATURE_METHODS)[number];

export const SPLIT_ROLE_LABEL: Record<SplitRole, string> = {
  writer: 'Writer',
  composer: 'Composer',
  writer_composer: 'Writer & composer',
  publisher: 'Publisher',
  master_owner: 'Master owner',
};

export const SPLIT_KIND_LABEL: Record<SplitKind, string> = {
  composition: 'Composition',
  master: 'Master',
};

export const SPLIT_STATUS_LABEL: Record<SplitStatus, string> = {
  draft: 'Draft',
  circulated: 'Circulated',
  signed: 'Signed',
  superseded: 'Superseded',
  disputed: 'Disputed',
};

/** A composition sheet splits the work; a master sheet splits the recording. */
export const ROLES_BY_KIND: Readonly<Record<SplitKind, readonly SplitRole[]>> = {
  composition: ['writer', 'composer', 'writer_composer', 'publisher'],
  master: ['master_owner'],
};

export const isSplitKind = (v: unknown): v is SplitKind => typeof v === 'string' && (SPLIT_KINDS as readonly string[]).includes(v);
export const isSplitStatus = (v: unknown): v is SplitStatus => typeof v === 'string' && (SPLIT_STATUSES as readonly string[]).includes(v);
export const isSplitRole = (v: unknown): v is SplitRole => typeof v === 'string' && (SPLIT_ROLES as readonly string[]).includes(v);

export const splitRoleLabel = (role: string): string => (isSplitRole(role) ? SPLIT_ROLE_LABEL[role] : role);

/** The role a new line of this kind starts with. */
export const defaultRoleFor = (kind: SplitKind): SplitRole => ROLES_BY_KIND[kind][0];

// ── Shares, in integer units ────────────────────────────────────────────

/** Units per percentage point (4 decimals). */
export const SHARE_SCALE = 10_000;
/** 100.0000 %. */
export const FULL_SHARE = 100 * SHARE_SCALE;

/**
 * "33.3333" / 33.3333 / "50" → units, or null when it is not a share: more
 * than 4 decimals, a sign, an exponent, a comma, an empty string, NaN. 0 and
 * anything over 100 parse (they are numbers) and `validateSheet` rejects
 * them as shares; a text input can be validated one field at a time.
 * No floating point: digits are split on the dot.
 */
export function parseShare(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = typeof input === 'number' ? (Number.isFinite(input) ? String(input) : '') : input.trim();
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(4, '0'));
  const units = whole * SHARE_SCALE + frac;
  return units > FULL_SHARE ? null : units;
}

/** Units → the decimal string the database stores ("33.3333", "50.0000"). */
export function shareToDb(units: number): string {
  const whole = Math.trunc(units / SHARE_SCALE);
  const frac = String(units % SHARE_SCALE).padStart(4, '0');
  return `${whole}.${frac}`;
}

/** Units → what a person reads: "33.3333", "50", "12.5" (trailing zeros dropped). */
export function formatShare(units: number): string {
  return shareToDb(units).replace(/\.?0+$/, '');
}

export function sumShares(shares: readonly number[]): number {
  let total = 0;
  for (const s of shares) total += s;
  return total;
}

export type SplitLineInput = {
  partyId: string;
  role: string;
  /** Integer units (see above). */
  units: number;
};

export type SplitIssue =
  | { code: 'no_lines'; message: string }
  | { code: 'bad_role'; message: string; index: number }
  | { code: 'bad_share'; message: string; index: number }
  | { code: 'duplicate'; message: string; index: number }
  | { code: 'total'; message: string; total: number; missing: number };

export type SheetCheck = {
  ok: boolean;
  /** Sum of the lines, in units. */
  total: number;
  /** FULL_SHARE − total: positive = still to give out, negative = over by this much. */
  remaining: number;
  issues: SplitIssue[];
};

/** Everything that stops a sheet from circulating. Same rules as the trigger in migration 155. */
export function validateSheet(kind: SplitKind, lines: readonly SplitLineInput[]): SheetCheck {
  const issues: SplitIssue[] = [];
  const total = sumShares(lines.map((l) => l.units));
  if (lines.length === 0) issues.push({ code: 'no_lines', message: 'Add at least one line.' });

  const allowed = ROLES_BY_KIND[kind] as readonly string[];
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (!allowed.includes(line.role)) {
      issues.push({ code: 'bad_role', index, message: `${splitRoleLabel(line.role)} is not a ${kind} role.` });
    }
    if (!Number.isInteger(line.units) || line.units <= 0 || line.units > FULL_SHARE) {
      issues.push({ code: 'bad_share', index, message: 'A share is more than 0 and at most 100.' });
    }
    const key = `${line.partyId}:${line.role}`;
    if (seen.has(key)) issues.push({ code: 'duplicate', index, message: 'The same person has the same role twice.' });
    seen.add(key);
  });

  if (lines.length > 0 && total !== FULL_SHARE) {
    const missing = FULL_SHARE - total;
    issues.push({
      code: 'total',
      total,
      missing,
      message:
        missing > 0
          ? `The shares add up to ${formatShare(total)}%; ${formatShare(missing)}% is still unassigned.`
          : `The shares add up to ${formatShare(total)}%; that is ${formatShare(-missing)}% too much.`,
    });
  }
  return { ok: issues.length === 0, total, remaining: FULL_SHARE - total, issues };
}

/**
 * What stops a DRAFT from being saved: a bad role, a share out of range, the
 * same person and role twice. An incomplete draft (no lines yet, not yet 100)
 * is the normal state of a draft and is not an issue here; `validateSheet` is
 * the circulate gate.
 */
export function draftIssues(kind: SplitKind, lines: readonly SplitLineInput[]): SplitIssue[] {
  return validateSheet(kind, lines).issues.filter((i) => i.code !== 'no_lines' && i.code !== 'total');
}

/**
 * "Add remainder": the share that would bring the sheet to exactly 100, or
 * null when nothing is missing (the sheet is full or over).
 */
export function suggestRemainder(lines: readonly Pick<SplitLineInput, 'units'>[]): number | null {
  const remaining = FULL_SHARE - sumShares(lines.map((l) => l.units));
  return remaining > 0 ? remaining : null;
}

/**
 * Split 100 into `count` equal parts that sum to exactly 100.0000. The
 * leftover units go one each to the first lines, so 3 → 33.3334, 33.3333,
 * 33.3333 — never 33.3333 × 3.
 */
export function evenShares(count: number): number[] {
  if (!Number.isInteger(count) || count < 1) return [];
  const base = Math.floor(FULL_SHARE / count);
  const extra = FULL_SHARE - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * The legal moves. `draft → circulated` (only if the sum is 100, a trigger
 * holds it), `circulated → signed | disputed | superseded`, and a signed or
 * disputed sheet can still be superseded by its next version. Nothing goes
 * back to a draft.
 */
const NEXT: Readonly<Record<SplitStatus, readonly SplitStatus[]>> = {
  draft: ['circulated'],
  circulated: ['signed', 'disputed', 'superseded'],
  signed: ['superseded'],
  disputed: ['superseded'],
  superseded: [],
};

export function canTransition(from: SplitStatus, to: SplitStatus): boolean {
  return NEXT[from].includes(to);
}

/** Lines and parties can change only while the sheet is a draft. */
export const isEditable = (status: string): boolean => status === 'draft';

/** A circulated, signed or disputed sheet is the version in force. */
export const isLive = (status: string): boolean => status === 'circulated' || status === 'signed' || status === 'disputed';

// ── Who may do what ─────────────────────────────────────────────────────

export type SplitLineFacts = {
  /** The account behind the line's party, if any. */
  partyUserId: string | null;
  signed: boolean;
};

/** Write access to any sheet needs `rights.write` (not an external member). */
export const canWriteSplits = (actor: CreditActor): boolean => canWriteRights(actor);

/** May this actor see split sheets at all? `rights.read`, or an own line (D2). */
export const canReadSplits = (actor: CreditActor): boolean => creditReach(actor) !== 'none';

export type SignPlan = { ok: true } | { ok: false; status: 403 | 404 | 409; error: string };

/**
 * Record a signature on one line.
 *  - `acknowledged`: the credited person says "this is mine and it is right".
 *    Only they can: nobody acknowledges on someone else's behalf. A line that
 *    is not theirs is 404 for a reader with only an own line (D2).
 *  - `upload`: a signed PDF. It becomes a restricted file, so it is a rights
 *    writer's act (the PDF needs `contracts.read` to be opened again); an
 *    external member never uploads.
 */
export function planSignature(
  actor: CreditActor,
  method: SplitSignatureMethod,
  sheetStatus: string,
  line: SplitLineFacts,
): SignPlan {
  const writer = canWriteSplits(actor);
  const own = !!line.partyUserId && line.partyUserId === actor.userId;
  if (!writer && !own) return { ok: false, status: 404, error: 'Not found' };
  if (sheetStatus !== 'circulated') {
    return { ok: false, status: 409, error: sheetStatus === 'draft' ? 'Circulate the sheet before it is signed' : 'This version is no longer open for signatures' };
  }
  if (method === 'acknowledged' && !own) return { ok: false, status: 403, error: 'Only the person named on a line can acknowledge it' };
  if (method === 'upload' && !writer) return { ok: false, status: 403, error: 'You cannot upload a signed document' };
  if (line.signed) return { ok: false, status: 409, error: 'This line is already signed' };
  return { ok: true };
}

// ── Views ───────────────────────────────────────────────────────────────

export type SplitSheetRow = {
  id: string;
  track_id: string;
  kind: string;
  version: number;
  status: string;
  note: string | null;
  document_asset_id: string | null;
  created_by: string | null;
  created_at: string;
  circulated_at: string | null;
  signed_at: string | null;
  superseded_at: string | null;
  superseded_by: string | null;
};

export type SplitLineRow = {
  id: string;
  split_sheet_id: string;
  party_id: string;
  role: string;
  /** numeric(7,4): PostgREST answers a JSON number (or a string, for some clients). */
  share: number | string;
  /** The order the sheet was written in. */
  position?: number;
  signed_at: string | null;
  signature_method: string | null;
  signature_asset_id: string | null;
};

export type SplitPartyFacts = {
  id: string;
  display_name: string;
  legal_name: string | null;
  ipi: string | null;
  user_id: string | null;
};

export type SplitLineView = {
  id: string;
  partyId: string;
  /** Always shown: the name on the sheet. */
  name: string;
  role: string;
  roleLabel: string;
  /** Integer units, and the display string. */
  units: number;
  share: string;
  mine: boolean;
  signed: boolean;
  signedAt: string | null;
  signatureMethod: SplitSignatureMethod | null;
  /** Only `rights.read` (or the person's own line): legal name and IPI. */
  legalName?: string | null;
  ipi?: string | null;
  can: { acknowledge: boolean; uploadSigned: boolean };
};

export type SplitSheetView = {
  id: string;
  trackId: string;
  kind: SplitKind | string;
  version: number;
  status: SplitStatus | string;
  statusLabel: string;
  note: string | null;
  createdAt: string;
  circulatedAt: string | null;
  signedAt: string | null;
  supersededAt: string | null;
  hasDocument: boolean;
  /** Present for `rights.read` only. An own-line reader is not told the others' shares or the total. */
  total?: string;
  signedCount?: number;
  lineCount?: number;
  lines: SplitLineView[];
  can: { edit: boolean; circulate: boolean; supersede: boolean };
};

export function unitsOf(share: number | string): number {
  return parseShare(typeof share === 'number' ? share.toFixed(4) : share) ?? 0;
}

/**
 * One sheet as the caller may see it, built field by field (no creator id, no
 * file key). `rights.read` sees every line, the total and legal identifiers.
 * An own line sees THEIR line(s) only (D2): no other name, no other share, no
 * total. Anyone with neither sees no lines and should not have reached here.
 */
export function sheetView(
  sheet: SplitSheetRow,
  lines: readonly SplitLineRow[],
  parties: ReadonlyMap<string, SplitPartyFacts>,
  actor: CreditActor,
): SplitSheetView {
  const reach = creditReach(actor);
  const writer = canWriteSplits(actor);
  const status = isSplitStatus(sheet.status) ? sheet.status : 'draft';
  const mineOf = (l: SplitLineRow) => {
    const uid = parties.get(l.party_id)?.user_id ?? null;
    return !!uid && uid === actor.userId;
  };
  const visible = reach === 'all' ? lines : reach === 'own' ? lines.filter(mineOf) : [];

  const views: SplitLineView[] = visible.map((l) => {
    const party = parties.get(l.party_id);
    const mine = mineOf(l);
    const method = l.signature_method === 'upload' || l.signature_method === 'acknowledged' ? l.signature_method : null;
    const facts: SplitLineFacts = { partyUserId: party?.user_id ?? null, signed: !!l.signed_at };
    const view: SplitLineView = {
      id: l.id,
      partyId: l.party_id,
      name: party?.display_name ?? 'Unknown',
      role: l.role,
      roleLabel: splitRoleLabel(l.role),
      units: unitsOf(l.share),
      share: formatShare(unitsOf(l.share)),
      mine,
      signed: !!l.signed_at,
      signedAt: l.signed_at,
      signatureMethod: method,
      can: {
        acknowledge: planSignature(actor, 'acknowledged', status, facts).ok,
        uploadSigned: planSignature(actor, 'upload', status, facts).ok,
      },
    };
    if (party && mayReadLegal(actor, party.user_id)) {
      view.legalName = party.legal_name;
      view.ipi = party.ipi;
    }
    return view;
  });

  const view: SplitSheetView = {
    id: sheet.id,
    trackId: sheet.track_id,
    kind: sheet.kind,
    version: sheet.version,
    status: sheet.status,
    statusLabel: isSplitStatus(sheet.status) ? SPLIT_STATUS_LABEL[sheet.status] : sheet.status,
    note: reach === 'all' && !actor.rosterArtist ? sheet.note : null,
    createdAt: sheet.created_at,
    circulatedAt: sheet.circulated_at,
    signedAt: sheet.signed_at,
    supersededAt: sheet.superseded_at,
    hasDocument: !!sheet.document_asset_id && reach === 'all' && !actor.rosterArtist,
    lines: views,
    can: {
      edit: writer && status === 'draft',
      circulate: writer && status === 'draft',
      supersede: writer && isLive(status),
    },
  };
  if (reach === 'all') {
    view.total = formatShare(sumShares(lines.map((l) => unitsOf(l.share))));
    view.lineCount = lines.length;
    view.signedCount = lines.filter((l) => !!l.signed_at).length;
  }
  return view;
}
