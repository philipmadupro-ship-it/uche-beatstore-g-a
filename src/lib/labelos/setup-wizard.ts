/**
 * The setup wizard (LABEL-48; extends the first slice in ./setup.ts and
 * docs/bstudio-label-os/25-team-accounts.md §3 phase 5).
 *
 * Five steps — 1 Who are you · 2 How you work · 3 Team and roster ·
 * 4 Departments · 5 Review and create. Every step but the first may be
 * skipped; skipping takes the face's preset, so a person who clicks Next five
 * times gets a sensible organization.
 *
 * NOTHING IS CREATED UNTIL THE LAST STEP. The wizard's state is one JSON
 * document (`WizardDraft`) that the page keeps in localStorage so a closed
 * tab resumes, and that is thrown away on success. Leaving at any earlier
 * point leaves no row anywhere. Passwords typed for a team login are never
 * part of what is saved.
 *
 * At the end, ONE request creates the org with its settings in a single
 * transaction (POST /api/org/setup → migration 192's `labelos_setup_org`).
 * What follows reuses the existing routes, so no member, contact or release
 * rule exists twice: the team and roster entries (./team-roster, the same
 * window the Team page uses, LABEL-50: roster artists, invitations, team
 * logins, collaborators) and the first draft release (POST …/releases). Those are separate requests; each reports its own
 * outcome and a failure leaves a normal, complete org plus a line saying what
 * to do from its own screen.
 *
 * Pure: no I/O. The runner is ./setup-wizard-client.ts, the page
 * src/components/labelos/OrgSetupWizard.tsx.
 */
import { EXTERNAL_PROJECT_ROLES, FUNCTIONS_BY_ORG_KIND, type OrgFunction, type OrgKind } from './capabilities';
import { parseContractTypes, type ContractTypeId } from './contract-types';
import { MODULES, type Module } from './entitlements';
import { invitableRoles, type InvitableRole } from './invitations';
import { contractsLockout, parseDepartmentsOff, planSettingsChange } from './org-settings';
import { RELEASE_TYPES, type ReleaseType } from './releases';
import { SETUP_NAME_MAX, cleanOrgName, isSetupFace, kindForFace, type SetupFace } from './setup';
import {
  COLLABORATOR_KINDS,
  ENTRY_MAX,
  entryProblems,
  emptyPerson,
  isEmail,
  type ArtistEntry,
  type CollaboratorEntry,
  type FollowUp,
  type FollowUpKind,
  type PersonEntry,
} from './team-roster';

export { isEmail, type FollowUp, type FollowUpKind };

// ── Steps ───────────────────────────────────────────────────────────────

export const WIZARD_STEPS = [
  { id: 'who', title: 'Who are you', skippable: false },
  { id: 'work', title: 'How you work', skippable: true },
  { id: 'team', title: 'Team and roster', skippable: true },
  { id: 'departments', title: 'Departments', skippable: true },
  { id: 'review', title: 'Review and create', skippable: false },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]['id'];
export const STEP_IDS: readonly WizardStepId[] = WIZARD_STEPS.map((s) => s.id);

export function isStepId(value: unknown): value is WizardStepId {
  return typeof value === 'string' && (STEP_IDS as readonly string[]).includes(value);
}

export function stepIndex(step: WizardStepId): number {
  return STEP_IDS.indexOf(step);
}

export function nextStep(step: WizardStepId): WizardStepId {
  return STEP_IDS[Math.min(stepIndex(step) + 1, STEP_IDS.length - 1)];
}

export function previousStep(step: WizardStepId): WizardStepId {
  return STEP_IDS[Math.max(stepIndex(step) - 1, 0)];
}

// ── Departments ─────────────────────────────────────────────────────────

/** The departments step switches these. Search, digest and export stay on: they are not departments. */
export const DEPARTMENT_CHOICES: readonly { module: Module; label: string; hint: string }[] = [
  { module: 'contracts', label: 'Contracts & legal', hint: 'Split sheets, legal approval, the legal pack.' },
  { module: 'finance', label: 'Finance', hint: 'Statements, royalties and payouts.' },
  { module: 'marketing', label: 'Marketing', hint: 'Marketing approval and campaign work.' },
  { module: 'pr', label: 'PR & press', hint: 'Press kits and outreach.' },
  { module: 'executive', label: 'Executive', hint: 'A read-only view across the organization.' },
  { module: 'artistic', label: 'Artistic direction', hint: 'Creative direction and sign-off.' },
  { module: 'store', label: 'Store listing', hint: 'Put released music on the public store.' },
];

const CHOICE_MODULES: readonly Module[] = DEPARTMENT_CHOICES.map((d) => d.module);

/**
 * What each face starts with. A person working alone has no finance, PR,
 * executive or artistic-direction team to give a screen to; a label has all
 * of them. These are only starting points — nothing here is a limit (the
 * org has no entitlement row, so it is licensed for every module) and the
 * owner can change any of it later in Organization settings.
 */
export const FACE_PRESETS: Readonly<Record<SetupFace, { departmentsOff: Module[]; contractTypes: ContractTypeId[] }>> = {
  independent: {
    departmentsOff: ['finance', 'pr', 'executive', 'artistic'],
    contractTypes: ['licence', 'producer', 'feature'],
  },
  label: {
    departmentsOff: [],
    contractTypes: ['recording', 'distribution', 'licence', 'producer', 'feature'],
  },
};

// ── The draft ───────────────────────────────────────────────────────────

/** The team step's entries are the Team page's (./team-roster): one set of types, one editor. */
export type RosterEntry = ArtistEntry;
export type TeamEntry = PersonEntry;

export type ReleaseDraft = { enabled: boolean; title: string; type: ReleaseType; artistIndex: number };

export type WizardDraft = {
  version: 1;
  step: WizardStepId;
  face: SetupFace | null;
  name: string;
  contractTypes: ContractTypeId[];
  roster: RosterEntry[];
  team: TeamEntry[];
  collaborators: CollaboratorEntry[];
  departmentsOff: Module[];
  /** True once the person changed a department: switching face then stops overwriting their choice. */
  departmentsTouched: boolean;
  contractsTouched: boolean;
  legalGate: 'on' | 'off';
  marketingGate: 'on' | 'off';
  release: ReleaseDraft;
};

export const emptyEntry = emptyPerson;

export function newDraft(face: SetupFace | null = null): WizardDraft {
  const preset = face ? FACE_PRESETS[face] : null;
  return {
    version: 1,
    step: 'who',
    face,
    name: '',
    contractTypes: preset ? [...preset.contractTypes] : [],
    roster: [],
    team: [],
    collaborators: [],
    departmentsOff: preset ? [...preset.departmentsOff] : [],
    departmentsTouched: false,
    contractsTouched: false,
    legalGate: 'on',
    marketingGate: 'on',
    release: { enabled: false, title: '', type: 'single', artistIndex: 0 },
  };
}

/** Pick a face. Choices the person has not touched follow the new face's preset. */
export function withFace(draft: WizardDraft, face: SetupFace): WizardDraft {
  if (draft.face === face) return draft;
  const preset = FACE_PRESETS[face];
  return {
    ...draft,
    face,
    departmentsOff: draft.departmentsTouched ? draft.departmentsOff : [...preset.departmentsOff],
    contractTypes: draft.contractsTouched ? draft.contractTypes : [...preset.contractTypes],
    // An independent artist is the roster; a label's roster list does not carry over to it.
    roster: face === 'label' ? draft.roster : [],
    // People pointed at roster artists lose that scope when the roster goes (their scope falls back to the whole org).
    team: face === 'label' ? draft.team : draft.team.map((t) => ({ ...t, scope: 'org' as const, artists: [] })),
    release: { ...draft.release, artistIndex: 0 },
  };
}

export function withDepartment(draft: WizardDraft, module: Module, on: boolean): WizardDraft {
  const off = new Set(draft.departmentsOff);
  if (on) off.delete(module);
  else off.add(module);
  return { ...draft, departmentsOff: parseDepartmentsOff([...off]), departmentsTouched: true };
}

export function withContractType(draft: WizardDraft, id: ContractTypeId, on: boolean): WizardDraft {
  const set = new Set(draft.contractTypes);
  if (on) set.add(id);
  else set.delete(id);
  return { ...draft, contractTypes: parseContractTypes([...set]), contractsTouched: true };
}

/**
 * The approval gates as they will be stored. Contracts & legal off with legal
 * approval required would leave a gate nobody can clear
 * (`contractsLockout`, the settings screen's rule), so switching the
 * department off takes the legal approval off with it. `forced` says so, so
 * the page can tell the person instead of changing it silently.
 */
export function effectiveGates(draft: Pick<WizardDraft, 'legalGate' | 'marketingGate' | 'departmentsOff'>): {
  legal_gate: 'on' | 'off';
  marketing_gate: 'on' | 'off';
  legalForcedOff: boolean;
} {
  const lockout = contractsLockout({ legal_gate: draft.legalGate, departments_off: parseDepartmentsOff(draft.departmentsOff) });
  return {
    legal_gate: lockout ? 'off' : draft.legalGate,
    marketing_gate: draft.marketingGate,
    legalForcedOff: lockout,
  };
}

/**
 * "Skip" on a step: leave it as if it had never been opened, so a half-typed
 * form cannot block the review. Steps 2 and 4 return to the face's preset,
 * the team step to nobody.
 */
export function skipStep(draft: WizardDraft, step: WizardStepId): WizardDraft {
  const preset = draft.face ? FACE_PRESETS[draft.face] : null;
  if (step === 'work') return { ...draft, contractTypes: preset ? [...preset.contractTypes] : [], contractsTouched: false };
  if (step === 'departments') return { ...draft, departmentsOff: preset ? [...preset.departmentsOff] : [], departmentsTouched: false };
  if (step === 'team') return { ...draft, roster: [], team: [], collaborators: [], release: { ...draft.release, artistIndex: 0, enabled: draft.face === 'label' ? false : draft.release.enabled } };
  return draft;
}

// ── What is sent ────────────────────────────────────────────────────────

export type SetupSettings = {
  legal_gate: 'on' | 'off';
  marketing_gate: 'on' | 'off';
  departments_off: Module[];
  contract_types: ContractTypeId[];
};

export function settingsFromDraft(draft: WizardDraft): SetupSettings {
  const gates = effectiveGates(draft);
  return {
    legal_gate: gates.legal_gate,
    marketing_gate: gates.marketing_gate,
    departments_off: parseDepartmentsOff(draft.departmentsOff),
    contract_types: parseContractTypes(draft.contractTypes),
  };
}

/** Every module a self-served org is licensed for: no entitlement row means all of them. */
export const SELF_SERVE_LICENSED: ReadonlySet<Module> = new Set(MODULES);

/**
 * The settings a new org is stored with: only the keys that differ from the
 * defaults (the same minimum `planSettingsChange` keeps for the settings
 * screen). `ok: false` carries the sentence to show.
 */
export function planSetupSettings(
  settings: Partial<SetupSettings> | undefined,
): { ok: true; patch: Record<string, unknown>; keys: string[] } | { ok: false; error: string } {
  const plan = planSettingsChange({ current: {}, patch: settings ?? {}, licensed: SELF_SERVE_LICENSED });
  if (!plan.ok) return plan;
  return { ok: true, patch: plan.patch, keys: plan.keys };
}

export function setupBodyFromDraft(draft: WizardDraft): { face: SetupFace; name: string; settings: SetupSettings } | null {
  if (!draft.face) return null;
  const name = cleanOrgName(draft.name);
  if (!name) return null;
  return { face: draft.face, name, settings: settingsFromDraft(draft) };
}

// ── Validation ──────────────────────────────────────────────────────────

export function orgKindOf(face: SetupFace | null): OrgKind | null {
  return face ? kindForFace(face) : null;
}

/** The function choices for a team member in this face (same table the invite dialog uses). */
export function teamFunctions(face: SetupFace): OrgFunction[] {
  return [...FUNCTIONS_BY_ORG_KIND[kindForFace(face)]];
}

export function teamRoles(face: SetupFace): Extract<InvitableRole, 'admin' | 'member'>[] {
  return invitableRoles(kindForFace(face)).filter((r): r is 'admin' | 'member' => r === 'admin' || r === 'member');
}

/** What is wrong with one step, as sentences. Empty = the step can be left. */
export function stepProblems(draft: WizardDraft, step: WizardStepId): string[] {
  const out: string[] = [];
  if (step === 'who') {
    if (!draft.face) out.push('Choose what kind of account this is.');
    if (!cleanOrgName(draft.name)) out.push(`Give it a name of 1 to ${SETUP_NAME_MAX} characters.`);
  }
  if (step === 'team' && draft.face) {
    out.push(
      ...entryProblems(
        { artists: draft.roster, people: draft.team, collaborators: draft.collaborators },
        { orgKind: kindForFace(draft.face), existingArtists: [] },
      ),
    );
  }
  if (step === 'review' && draft.release.enabled) {
    if (!draft.release.title.trim()) out.push('Name the first release, or switch it off.');
    if (draft.face === 'label' && !rosterNames(draft)[draft.release.artistIndex]) out.push('Choose which artist the first release is for.');
    if (draft.face === 'independent' && draft.release.title.trim().length > 300) out.push('The release title is too long.');
  }
  return out;
}

/** The first step that cannot be left yet, or null when the draft can be created. */
export function firstBlockedStep(draft: WizardDraft): WizardStepId | null {
  for (const step of STEP_IDS) {
    if (stepProblems(draft, step).length > 0) return step;
  }
  return null;
}

export function rosterNames(draft: WizardDraft): string[] {
  return draft.roster.map((r) => r.name.trim()).filter(Boolean);
}

// ── Review ──────────────────────────────────────────────────────────────

export function departmentsOn(draft: Pick<WizardDraft, 'departmentsOff'>): Module[] {
  const off = new Set(draft.departmentsOff);
  return CHOICE_MODULES.filter((m) => !off.has(m));
}

// ── Saved draft ─────────────────────────────────────────────────────────

export const DRAFT_KEY_PREFIX = 'labelos.setup.draft.v1:';

/** One key per account, so a shared browser never offers one person's draft to another. */
export function draftKey(userId: string): string {
  return `${DRAFT_KEY_PREFIX}${userId}`;
}

/** The draft as saved: passwords removed. */
export function serializeDraft(draft: WizardDraft): string {
  return JSON.stringify({ ...draft, team: draft.team.map((t) => ({ ...t, password: '' })) });
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function list<T>(raw: unknown, max: number, each: (v: unknown) => T | null): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  for (const v of raw.slice(0, max)) {
    const item = each(v);
    if (item) out.push(item);
  }
  return out;
}

/**
 * Total over anything a browser can hand back: a draft saved by an older
 * build, edited by hand or cut short reads as far as it is sound and as the
 * defaults beyond that. Never throws.
 */
export function parseDraft(raw: unknown): WizardDraft | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const d = value as Record<string, unknown>;
  if (d.version !== 1) return null;
  const face = isSetupFace(d.face) ? d.face : null;
  const base = newDraft(face);
  const release = d.release && typeof d.release === 'object' ? (d.release as Record<string, unknown>) : {};
  const roles = face ? teamRoles(face) : [];
  const fns = face ? teamFunctions(face) : [];
  return {
    ...base,
    step: isStepId(d.step) ? d.step : 'who',
    name: str(d.name, SETUP_NAME_MAX),
    contractTypes: d.contractTypes === undefined ? base.contractTypes : parseContractTypes(d.contractTypes),
    roster: face === 'label'
      ? list(d.roster, ENTRY_MAX, (v) => {
          if (!v || typeof v !== 'object') return null;
          const r = v as Record<string, unknown>;
          return { name: str(r.name, 200), email: str(r.email, 200), invite: r.invite === true } satisfies RosterEntry;
        })
      : [],
    team: list(d.team, ENTRY_MAX, (v) => {
      if (!v || typeof v !== 'object') return null;
      const t = v as Record<string, unknown>;
      const role = roles.find((r) => r === t.role) ?? 'member';
      const fn = fns.find((f) => f === t.fn) ?? null;
      return {
        email: str(t.email, 200),
        role,
        fn: role === 'member' ? fn : null,
        mode: t.mode === 'login' ? 'login' : 'invite',
        name: str(t.name, 80),
        password: '',
        scope: role === 'member' && t.scope === 'artists' ? 'artists' : 'org',
        artists: Array.isArray(t.artists) ? t.artists.filter((a): a is string => typeof a === 'string').slice(0, ENTRY_MAX).map((a) => a.slice(0, 200)) : [],
      } satisfies TeamEntry;
    }),
    collaborators: list(d.collaborators, ENTRY_MAX, (v) => {
      if (!v || typeof v !== 'object') return null;
      const c = v as Record<string, unknown>;
      return {
        name: str(c.name, 200),
        email: str(c.email, 200),
        kind: COLLABORATOR_KINDS.find((k) => k.id === c.kind)?.id ?? 'beatmaker',
        // A project does not exist before the org does: the wizard never offers one.
        projectId: '',
        projectRole: EXTERNAL_PROJECT_ROLES.find((r) => r === c.projectRole) ?? 'viewer',
      } satisfies CollaboratorEntry;
    }),
    departmentsOff: d.departmentsOff === undefined ? base.departmentsOff : parseDepartmentsOff(d.departmentsOff),
    departmentsTouched: d.departmentsTouched === true,
    contractsTouched: d.contractsTouched === true,
    legalGate: d.legalGate === 'off' ? 'off' : 'on',
    marketingGate: d.marketingGate === 'off' ? 'off' : 'on',
    release: {
      enabled: release.enabled === true,
      title: str(release.title, 300),
      type: (RELEASE_TYPES as readonly unknown[]).includes(release.type) ? (release.type as ReleaseType) : 'single',
      artistIndex: Number.isInteger(release.artistIndex) && (release.artistIndex as number) >= 0 ? (release.artistIndex as number) : 0,
    },
  };
}

/** The slice of `Storage` the wizard uses, so tests need no DOM. */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Reads never throw: private windows and blocked site data make storage unusable, and the wizard then simply starts clean. */
export function loadDraft(storage: DraftStorage | null, userId: string): WizardDraft | null {
  try {
    return storage ? parseDraft(storage.getItem(draftKey(userId))) : null;
  } catch {
    return null;
  }
}

export function saveDraft(storage: DraftStorage | null, userId: string, draft: WizardDraft): boolean {
  try {
    storage?.setItem(draftKey(userId), serializeDraft(draft));
    return !!storage;
  } catch {
    return false;
  }
}

export function clearDraft(storage: DraftStorage | null, userId: string): void {
  try {
    storage?.removeItem(draftKey(userId));
  } catch {
    /* nothing to clear */
  }
}

/** Has the person entered anything worth offering to resume? */
export function isUntouched(draft: WizardDraft): boolean {
  const fresh = newDraft(draft.face);
  return (
    draft.step === 'who' &&
    draft.name.trim() === '' &&
    draft.roster.length === 0 &&
    draft.team.length === 0 &&
    draft.collaborators.length === 0 &&
    !draft.departmentsTouched &&
    !draft.contractsTouched &&
    draft.legalGate === fresh.legalGate &&
    draft.marketingGate === fresh.marketingGate &&
    !draft.release.enabled
  );
}

// ── Requests after the org exists ───────────────────────────────────────

/** The first draft release, for the artist `contactId` (the org's roster artist). */
export function releaseRequest(draft: WizardDraft, contactId: string): FollowUp | null {
  if (!draft.release.enabled || !draft.release.title.trim()) return null;
  return {
    kind: 'release',
    label: draft.release.title.trim(),
    method: 'POST',
    path: '/releases',
    body: { title: draft.release.title.trim(), type: draft.release.type, contact_id: contactId },
    fixIn: 'Releases',
  };
}
