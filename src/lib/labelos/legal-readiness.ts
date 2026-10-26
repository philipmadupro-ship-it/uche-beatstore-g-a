/**
 * Legal readiness of one song (LABEL-29, 09 §3.1–3.2): the fourteen
 * requirements a legal handoff needs, derived from what is already stored
 * (title, credits, parties, split sheets, release membership, samples,
 * ISRC). Nothing here is written to a column — like store readiness
 * (`lib/store/readiness.ts`) it is recomputed, so it classifies the whole
 * back catalogue retroactively and cannot go stale.
 *
 * Pure. The route loads the facts and decides who may see the reasons;
 * `redactReadiness` is the one place that turns a result into the count-only
 * shape for a caller without `rights.read`.
 *
 * GATES USE `blockers.length === 0` (`isReady`), NEVER THE PERCENTAGE: a
 * percentage implies partial legal sufficiency. The score is display only.
 *
 * Score = satisfied weight / applicable weight, blockers weigh 3, warnings 1,
 * requirements that do not apply are excluded. It never reads 100 while a
 * requirement is open (rounding is capped at 99).
 *
 * Two judgement calls the spec leaves open, both flagged in the PR:
 *  - L8 is two checks: the DECLARATION (`L8`, always applicable) and the
 *    CLEARANCE note (`L8.clearance`, applicable only when samples = yes),
 *    which is how §3.2 can exclude "L8 clearance when there are no samples".
 *  - L13 is a blocker only while a credit is `disputed`; a `proposed` credit
 *    is a warning. A satisfied L13 weighs as the warning it would have been.
 */
import type { CreditScope } from './credit-roles';
import { FULL_SHARE, isLive, sumShares, unitsOf } from './splits';

export const REQUIREMENT_CODES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8', 'L8.clearance', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14'] as const;
export type RequirementCode = (typeof REQUIREMENT_CODES)[number];

export type Severity = 'blocker' | 'warning';

/** The capability that can close the gap (09 §3.1 "Fix capability"). */
export type FixCapability = 'catalog.write' | 'rights.write' | 'release.write';

export const SEVERITY_WEIGHT: Record<Severity, number> = { blocker: 3, warning: 1 };

/** Roles that make someone a writer of the work (composition credits that write, not arrange). */
export const WRITER_ROLES = ['songwriter', 'composer', 'lyricist'] as const;
const PRODUCER_ROLES = ['producer', 'co_producer', 'executive_producer'] as const;
const FEATURE_ROLES = ['feature'] as const;
/** Split-line roles that stand for a writer's share of the composition. */
const WRITER_LINE_ROLES = ['writer', 'composer', 'writer_composer'] as const;

// ── Facts ───────────────────────────────────────────────────────────────

export type ReadinessCredit = {
  id: string;
  role: string;
  scope: CreditScope | null;
  status: string;
  partyId: string | null;
  /** The credited name as typed, for a credit with no party yet. */
  name: string;
};

export type ReadinessParty = {
  id: string;
  displayName: string;
  legalName: string | null;
  ipi: string | null;
  pro: string | null;
  proAffiliation: string;
  publisherName: string | null;
};

export type ReadinessSheetLine = { partyId: string; role: string; share: number | string; signed: boolean };

export type ReadinessSheet = {
  id: string;
  kind: 'composition' | 'master';
  version: number;
  status: string;
  lines: readonly ReadinessSheetLine[];
};

export type SamplesDeclared = 'none' | 'yes' | 'unknown';

export type LegalFacts = {
  title: string | null;
  credits: readonly ReadinessCredit[];
  parties: readonly ReadinessParty[];
  /** Every version of every sheet of the song; the module picks the one in force. */
  sheets: readonly ReadinessSheet[];
  onRelease: boolean;
  samples: SamplesDeclared;
  /** A clearance note or document is attached (only meaningful when samples = yes). */
  sampleClearance: boolean;
  /** `organizations.settings.require_signed_master_split`. */
  requireSignedMasterSplit: boolean;
  /** The ISRC of the master recording (release master, else linked master, else the song). */
  isrc: string | null;
};

// ── Result ──────────────────────────────────────────────────────────────

export type Reason = {
  code: RequirementCode;
  severity: Severity;
  message: string;
  fixCapability: FixCapability;
  /** The party the gap is about, so a screen can link to it. */
  partyId?: string;
  creditId?: string;
  sheetId?: string;
};

export type RequirementResult = {
  code: RequirementCode;
  label: string;
  severity: Severity;
  applicable: boolean;
  satisfied: boolean;
  weight: number;
  fixCapability: FixCapability;
  reasons: Reason[];
};

export type ReadinessScore = {
  /** Display only. 0–100, and 100 only when nothing is open. */
  percent: number;
  satisfiedWeight: number;
  applicableWeight: number;
};

export type LegalReadiness = {
  requirements: RequirementResult[];
  blockers: Reason[];
  warnings: Reason[];
  score: ReadinessScore;
};

/** The gate. Never the score. */
export const isReady = (r: Pick<LegalReadiness, 'blockers'>): boolean => r.blockers.length === 0;

// ── Evaluation ──────────────────────────────────────────────────────────

const blank = (v: string | null | undefined): boolean => !v || v.trim() === '';

type Check = {
  code: RequirementCode;
  label: string;
  fixCapability: FixCapability;
  severity: Severity;
  applicable?: boolean;
  reasons: Omit<Reason, 'code' | 'severity' | 'fixCapability'>[];
  /** Severity of the failing state, when it differs from the nominal one. */
  failSeverity?: Severity;
};

function result(c: Check): RequirementResult {
  const satisfied = c.reasons.length === 0;
  const severity = !satisfied && c.failSeverity ? c.failSeverity : c.severity;
  return {
    code: c.code,
    label: c.label,
    severity,
    applicable: c.applicable ?? true,
    satisfied,
    weight: SEVERITY_WEIGHT[severity],
    fixCapability: c.fixCapability,
    reasons: c.reasons.map((r) => ({ ...r, code: c.code, severity, fixCapability: c.fixCapability })),
  };
}

/** The version in force of a kind: circulated / signed / disputed, newest first. A draft is not in force. */
function sheetInForce(sheets: readonly ReadinessSheet[], kind: 'composition' | 'master'): ReadinessSheet | null {
  return [...sheets].filter((s) => s.kind === kind && isLive(s.status)).sort((a, b) => b.version - a.version)[0] ?? null;
}

function hasDraft(sheets: readonly ReadinessSheet[], kind: 'composition' | 'master'): boolean {
  return sheets.some((s) => s.kind === kind && s.status === 'draft');
}

const sheetTotal = (s: ReadinessSheet): number => sumShares(s.lines.map((l) => unitsOf(l.share)));

/** The writers of the work: one entry per party (a person with two writing credits is one writer). */
function writersOf(facts: LegalFacts): { key: string; partyId: string | null; name: string; party: ReadinessParty | null; creditIds: string[] }[] {
  const parties = new Map(facts.parties.map((p) => [p.id, p]));
  const out = new Map<string, { key: string; partyId: string | null; name: string; party: ReadinessParty | null; creditIds: string[] }>();
  for (const c of facts.credits) {
    if (!(WRITER_ROLES as readonly string[]).includes(c.role)) continue;
    const party = c.partyId ? parties.get(c.partyId) ?? null : null;
    const key = c.partyId ? `p:${c.partyId}` : `n:${c.name.trim().toLowerCase()}`;
    const entry = out.get(key) ?? { key, partyId: c.partyId, name: party?.displayName ?? c.name, party, creditIds: [] };
    entry.creditIds.push(c.id);
    out.set(key, entry);
  }
  return [...out.values()];
}

const hasRole = (facts: LegalFacts, roles: readonly string[]): boolean => facts.credits.some((c) => roles.includes(c.role));

export function evaluateLegalReadiness(facts: LegalFacts): LegalReadiness {
  const writers = writersOf(facts);
  const checks: Check[] = [];

  // L1 — title.
  checks.push({
    code: 'L1',
    label: 'Song title',
    fixCapability: 'catalog.write',
    severity: 'blocker',
    reasons: blank(facts.title) ? [{ message: 'The song has no title.' }] : [],
  });

  // L2 — at least one writer / composer credit.
  checks.push({
    code: 'L2',
    label: 'Writer credited',
    fixCapability: 'rights.write',
    severity: 'blocker',
    reasons: writers.length === 0 ? [{ message: 'No writer or composer is credited.' }] : [],
  });

  // L3 — every writer has a legal name.
  checks.push({
    code: 'L3',
    label: 'Writers have a legal name',
    fixCapability: 'rights.write',
    severity: 'blocker',
    reasons: writers
      .filter((w) => !w.party || blank(w.party.legalName))
      .map((w) => ({
        partyId: w.partyId ?? undefined,
        creditId: w.creditIds[0],
        message: w.party ? `${w.name} has no legal name.` : `${w.name} is credited but is not linked to a rights holder.`,
      })),
  });

  // L4 — PRO + IPI, or explicitly not affiliated.
  checks.push({
    code: 'L4',
    label: 'Writers have a PRO and IPI',
    fixCapability: 'rights.write',
    severity: 'blocker',
    reasons: writers
      .filter((w) => {
        const p = w.party;
        if (!p) return true;
        if (p.proAffiliation === 'not_affiliated') return false;
        return !(p.proAffiliation === 'affiliated' && !blank(p.pro) && !blank(p.ipi));
      })
      .map((w) => {
        const p = w.party;
        const missing = !p ? 'is not linked to a rights holder' : p.proAffiliation === 'affiliated' ? `is missing ${[blank(p.pro) ? 'a PRO' : '', blank(p.ipi) ? 'an IPI' : ''].filter(Boolean).join(' and ')}` : 'has not said whether they belong to a PRO';
        return { partyId: w.partyId ?? undefined, creditId: w.creditIds[0], message: `${w.name} ${missing}.` };
      }),
  });

  // L5 — publisher, or explicitly not affiliated (no publishing administrator to name).
  checks.push({
    code: 'L5',
    label: 'Writers have a publisher',
    fixCapability: 'rights.write',
    severity: 'warning',
    reasons: writers
      .filter((w) => !w.party || (blank(w.party.publisherName) && w.party.proAffiliation !== 'not_affiliated'))
      .map((w) => ({ partyId: w.partyId ?? undefined, creditId: w.creditIds[0], message: `${w.name} has no publisher.` })),
  });

  // L6 / L7 — composition split sheet.
  const comp = sheetInForce(facts.sheets, 'composition');
  const l6: Check['reasons'] = [];
  if (!comp) {
    l6.push({ message: hasDraft(facts.sheets, 'composition') ? 'The composition split sheet is still a draft.' : 'There is no composition split sheet.' });
  } else {
    const total = sheetTotal(comp);
    if (total !== FULL_SHARE) l6.push({ sheetId: comp.id, message: 'The composition split does not add up to 100%.' });
    const onSheet = new Set(comp.lines.filter((l) => (WRITER_LINE_ROLES as readonly string[]).includes(l.role)).map((l) => l.partyId));
    for (const w of writers) {
      if (!w.partyId || !onSheet.has(w.partyId)) {
        l6.push({ sheetId: comp.id, partyId: w.partyId ?? undefined, creditId: w.creditIds[0], message: `${w.name} is credited as a writer but is not on the composition split.` });
      }
    }
  }
  checks.push({ code: 'L6', label: 'Composition split adds up', fixCapability: 'rights.write', severity: 'blocker', reasons: l6 });

  const l7: Check['reasons'] = [];
  if (!comp) l7.push({ message: 'There is no composition split to sign.' });
  else if (comp.status !== 'signed') {
    const signed = comp.lines.filter((l) => l.signed).length;
    l7.push({ sheetId: comp.id, message: `The composition split is not signed (${signed} of ${comp.lines.length} signatures).` });
  }
  checks.push({ code: 'L7', label: 'Composition split signed', fixCapability: 'rights.write', severity: 'blocker', reasons: l7 });

  // L8 — samples declared; clearance when there are samples.
  checks.push({
    code: 'L8',
    label: 'Samples declared',
    fixCapability: 'catalog.write',
    severity: 'blocker',
    reasons: facts.samples === 'unknown' ? [{ message: 'Samples have not been declared (none, or yes).' }] : [],
  });
  checks.push({
    code: 'L8.clearance',
    label: 'Sample clearance attached',
    fixCapability: 'catalog.write',
    severity: 'blocker',
    applicable: facts.samples === 'yes',
    reasons: facts.samples === 'yes' && !facts.sampleClearance ? [{ message: 'The song uses samples and no clearance note or document is attached.' }] : [],
  });

  // L9 — producers credited on the master.
  checks.push({
    code: 'L9',
    label: 'Producers credited',
    fixCapability: 'rights.write',
    severity: 'warning',
    reasons: hasRole(facts, PRODUCER_ROLES) ? [] : [{ message: 'No producer is credited on the recording.' }],
  });

  // L10 / L11 — master ownership split.
  const master = sheetInForce(facts.sheets, 'master');
  const l10: Check['reasons'] = [];
  if (!master) l10.push({ message: hasDraft(facts.sheets, 'master') ? 'The master split sheet is still a draft.' : 'There is no master ownership split sheet.' });
  else if (sheetTotal(master) !== FULL_SHARE) l10.push({ sheetId: master.id, message: 'The master split does not add up to 100%.' });
  checks.push({ code: 'L10', label: 'Master split adds up', fixCapability: 'rights.write', severity: 'blocker', applicable: facts.onRelease, reasons: l10 });

  const l11: Check['reasons'] = [];
  if (!master) l11.push({ message: 'There is no master split to sign.' });
  else if (master.status !== 'signed') {
    const signed = master.lines.filter((l) => l.signed).length;
    l11.push({ sheetId: master.id, message: `The master split is not signed (${signed} of ${master.lines.length} signatures).` });
  }
  checks.push({
    code: 'L11',
    label: 'Master split signed',
    fixCapability: 'rights.write',
    severity: facts.requireSignedMasterSplit ? 'blocker' : 'warning',
    reasons: l11,
  });

  // L12 — featured artists credited: a title that names one needs a feature credit.
  const names = /\b(feat\.?|ft\.?|featuring)\b/i.test(facts.title ?? '');
  checks.push({
    code: 'L12',
    label: 'Featured artists credited',
    fixCapability: 'rights.write',
    severity: 'warning',
    reasons: names && !hasRole(facts, FEATURE_ROLES) ? [{ message: 'The title names a featured artist who is not credited.' }] : [],
  });

  // L13 — every credit confirmed; disputed turns the warning into a blocker.
  const open = facts.credits.filter((c) => c.status !== 'confirmed');
  const disputed = open.some((c) => c.status === 'disputed');
  checks.push({
    code: 'L13',
    label: 'Credits confirmed',
    fixCapability: 'rights.write',
    severity: 'warning',
    failSeverity: disputed ? 'blocker' : 'warning',
    reasons: open.map((c) => ({
      creditId: c.id,
      partyId: c.partyId ?? undefined,
      message: c.status === 'disputed' ? `${c.name}’s credit is disputed.` : `${c.name}’s credit is not confirmed yet.`,
    })),
  });

  // L14 — ISRC on the master recording.
  checks.push({
    code: 'L14',
    label: 'ISRC on the master',
    fixCapability: 'release.write',
    severity: 'warning',
    reasons: blank(facts.isrc) ? [{ message: 'The master recording has no ISRC.' }] : [],
  });

  const requirements = checks.map(result);
  const open_ = requirements.filter((r) => r.applicable);
  const reasons = open_.flatMap((r) => r.reasons);
  const applicableWeight = open_.reduce((n, r) => n + r.weight, 0);
  const satisfiedWeight = open_.filter((r) => r.satisfied).reduce((n, r) => n + r.weight, 0);
  const allSatisfied = satisfiedWeight === applicableWeight;
  const percent = applicableWeight === 0 ? 100 : allSatisfied ? 100 : Math.min(99, Math.round((satisfiedWeight / applicableWeight) * 100));

  return {
    requirements,
    // Blockers first in each list, then in requirement order.
    blockers: reasons.filter((r) => r.severity === 'blocker'),
    warnings: reasons.filter((r) => r.severity === 'warning'),
    score: { percent, satisfiedWeight, applicableWeight },
  };
}

// ── What a caller may be told ───────────────────────────────────────────

/** Full reasons: legal names, IPI, PRO and split shares can all be named in them. */
export type FullReadiness = {
  detail: 'full';
  ready: boolean;
  percent: number;
  blockerCount: number;
  warningCount: number;
  requirements: {
    code: RequirementCode;
    label: string;
    severity: Severity;
    applicable: boolean;
    satisfied: boolean;
    fixCapability: FixCapability;
    reasons: { message: string; severity: Severity; fixCapability: FixCapability; partyId: string | null; creditId: string | null; sheetId: string | null }[];
  }[];
};

/** Without `rights.read`: how many gaps, never which. */
export type CountsOnlyReadiness = {
  detail: 'counts';
  ready: boolean;
  percent: number;
  blockerCount: number;
  warningCount: number;
};

export type ReadinessView = FullReadiness | CountsOnlyReadiness;

/** Field by field: a new property of `Reason` is never sent until it is named here. */
export function readinessView(r: LegalReadiness, mayReadRights: boolean): ReadinessView {
  const counts = { ready: isReady(r), percent: r.score.percent, blockerCount: r.blockers.length, warningCount: r.warnings.length };
  if (!mayReadRights) return { detail: 'counts', ...counts };
  return {
    detail: 'full',
    ...counts,
    requirements: r.requirements.map((q) => ({
      code: q.code,
      label: q.label,
      severity: q.severity,
      applicable: q.applicable,
      satisfied: q.satisfied,
      fixCapability: q.fixCapability,
      reasons: q.reasons.map((x) => ({
        message: x.message,
        severity: x.severity,
        fixCapability: x.fixCapability,
        partyId: x.partyId ?? null,
        creditId: x.creditId ?? null,
        sheetId: x.sheetId ?? null,
      })),
    })),
  };
}
