/**
 * Needs attention (LABEL-35, 04 W8, 07 §2.1 / §3.2): the owner's exception
 * list on the org Overview. Three kinds of item, all DERIVED on every read
 * (nothing is stored, like release readiness and triage):
 *
 *  - `release`  a draft release whose target date is within the threshold
 *               (or past) with at least one gate holding BLOCKERS (LABEL-32;
 *               never the percentage score);
 *  - `song`     a song in a working stage for MORE than the threshold;
 *  - `tasks`    a person's overdue open tasks (LABEL-23), ONE item per
 *               accountable person.
 *
 * Every item names a person (who is accountable) and one next action (a verb
 * and a link) — 07 §3.2. Pure: `attention-store.ts` reads the rows, applies
 * the member's artist scope and D4 BEFORE this runs, and hands in only what
 * the member may see. `artistScope` is checked again here as a second line:
 * an item whose artists are all outside it is dropped, never listed.
 *
 * Order is stable: severity, then due date (earliest first, undated last),
 * then id.
 */
import { categorizeDue } from '@/lib/contacts/tasks';
import type { OrgAttentionSettings } from '@/lib/contracts';
import { RELEASE_GATE_LABEL, type ReleaseGate } from './release-readiness';
import { SONG_STAGE_LABEL, isSongStage, type SongStage } from './song-stage';
import { targetHref, type TaskTarget } from './tasks';

/**
 * The stages a song can be STUCK in: the ones where someone is meant to be
 * moving it. `inbox` is the A&R queue (the A&R inbox already sorts it oldest
 * first), `selected` waits for a release slot on purpose, and the rest are
 * parked or finished.
 */
export const STALLABLE_STAGES = ['in_review', 'shortlisted', 'in_development'] as const satisfies readonly SongStage[];
export function isStallableStage(stage: unknown): stage is (typeof STALLABLE_STAGES)[number] {
  return typeof stage === 'string' && (STALLABLE_STAGES as readonly string[]).includes(stage);
}

export type AttentionKind = 'release' | 'song' | 'tasks';

/** Higher first: a blocked release past its date, one still ahead of it, a stalled song, overdue tasks. */
export const SEVERITY = { releasePast: 4, releaseSoon: 3, song: 2, tasks: 1 } as const;

/** Who is accountable. `id` is null when only a name is known (the artist, as a last resort). */
export type AttentionPerson = { id: string | null; name: string };

export type AttentionAction = { verb: string; href: string };

export type AttentionItem = {
  /** Stable: `release:<id>`, `song:<id>`, `tasks:<person id|none>`. */
  id: string;
  kind: AttentionKind;
  severity: number;
  /** "EP 2027", "Track 04", "2 overdue tasks". */
  title: string;
  artistName: string | null;
  /** The one line under the title: what is wrong and for how long. */
  detail: string;
  person: AttentionPerson;
  /** Everyone named in `detail` (a release can be blocked on two people). `person` is the first. */
  people: AttentionPerson[];
  action: AttentionAction;
  /** The date the item is ordered by (YYYY-MM-DD), null = undated. */
  dueDate: string | null;
};

// ── Inputs ──────────────────────────────────────────────────────────────

export type AttentionReleaseGate = {
  gate: ReleaseGate;
  /** The gate holds at least one blocker. */
  blocked: boolean;
  /** Who is asked to clear it (the pending approval's approver), when known. */
  person: AttentionPerson | null;
};

export type AttentionRelease = {
  id: string;
  title: string;
  artistIds: readonly string[];
  artistName: string | null;
  /** 'draft' only: delivered and cancelled releases gate nothing. */
  state: string;
  /** YYYY-MM-DD. */
  targetDate: string | null;
  gates: readonly AttentionReleaseGate[];
  /** Whoever runs the release (its creator): the fallback when a gate has nobody asked. */
  owner: AttentionPerson | null;
};

export type AttentionSong = {
  id: string;
  title: string | null;
  artistIds: readonly string[];
  artistName: string | null;
  stage: string | null;
  /** When it entered this stage: the last stage move into it, else when it was created. */
  since: string;
  /** Who last moved it (else who uploaded it). */
  person: AttentionPerson | null;
  /** D4: the member may read this song's row. Unreadable songs are counted, never listed. */
  readable: boolean;
};

export type AttentionTask = {
  id: string;
  title: string;
  dueAt: string | null;
  assignee: AttentionPerson | null;
  /** Who made it, when nobody holds it. */
  creator: AttentionPerson | null;
  target: TaskTarget;
};

export type AttentionInput = {
  orgSlug: string;
  /** The reading instant. */
  now: Date;
  settings: OrgAttentionSettings;
  /** null = the whole org; otherwise the roster contacts the member may see. */
  artistScope: ReadonlySet<string> | null;
  releases: readonly AttentionRelease[];
  songs: readonly AttentionSong[];
  tasks: readonly AttentionTask[];
};

export type AttentionResult = {
  items: AttentionItem[];
  /** Stalled songs the member may not read (D4): a number, never a title. */
  restricted: number;
};

// ── Dates ───────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days from today (UTC) to a YYYY-MM-DD date; negative = past. NaN for anything else. */
export function daysUntil(date: string | null | undefined, now: Date): number {
  if (!date || !/^\d{4}-\d{2}-\d{2}/.test(date)) return NaN;
  const t = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(t) ? NaN : Math.round((t - utcDay(now)) / DAY);
}

/** Whole days an instant lies in the past (never negative). NaN for a bad timestamp. */
export function daysSince(iso: string | null | undefined, now: Date): number {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return NaN;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY));
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const first = (name: string): string => name.trim().split(/\s+/)[0] || name;

function inScope(scope: ReadonlySet<string> | null, artistIds: readonly string[]): boolean {
  if (scope === null) return true;
  return artistIds.some((id) => scope.has(id.toLowerCase()));
}

// ── Links ───────────────────────────────────────────────────────────────

export function attentionHref(orgSlug: string, target: { kind: 'release' | 'song' | 'tasks'; id: string }): string {
  const base = `/o/${encodeURIComponent(orgSlug)}`;
  if (target.kind === 'release') return `${base}/releases/${target.id}`;
  if (target.kind === 'song') return `${base}/songs/${target.id}`;
  return base;
}

// ── Items ───────────────────────────────────────────────────────────────

function samePerson(a: AttentionPerson, b: AttentionPerson): boolean {
  return a.id !== null && b.id !== null ? a.id.toLowerCase() === b.id.toLowerCase() : a.name === b.name;
}

function unique(people: readonly AttentionPerson[]): AttentionPerson[] {
  const out: AttentionPerson[] = [];
  for (const p of people) if (!out.some((o) => samePerson(o, p))) out.push(p);
  return out;
}

function releaseItem(r: AttentionRelease, input: AttentionInput): AttentionItem | null {
  if (r.state !== 'draft') return null;
  const days = daysUntil(r.targetDate, input.now);
  if (Number.isNaN(days) || days > input.settings.attention_release_days) return null;
  const blocked = r.gates.filter((g) => g.blocked);
  if (blocked.length === 0) return null;

  const accountable = (g: AttentionReleaseGate): AttentionPerson | null => g.person ?? r.owner;
  const fallback: AttentionPerson = { id: null, name: r.artistName ?? 'Nobody' };
  // Someone who was actually asked to clear a gate comes before the release owner's fallback.
  const people = unique([
    ...blocked.map((g) => g.person).filter((p): p is AttentionPerson => p !== null),
    ...blocked.map(accountable).filter((p): p is AttentionPerson => p !== null),
  ]);
  const named = blocked.map((g) => {
    const p = accountable(g);
    return p ? `${RELEASE_GATE_LABEL[g.gate]} (${first(p.name)})` : RELEASE_GATE_LABEL[g.gate];
  });
  const when = days < 0 ? `target passed ${plural(-days, 'day')} ago` : days === 0 ? 'target is today' : `target in ${plural(days, 'day')}`;
  const firstGate = RELEASE_GATE_LABEL[blocked[0].gate];
  return {
    id: `release:${r.id}`,
    kind: 'release',
    severity: days < 0 ? SEVERITY.releasePast : SEVERITY.releaseSoon,
    title: r.title,
    artistName: r.artistName,
    detail: `Blocked: ${named.join(', ')} · ${when}`,
    person: people[0] ?? fallback,
    people: people.length ? people : [fallback],
    action: { verb: blocked.length === 1 ? `Unblock ${firstGate}` : `Unblock ${plural(blocked.length, 'gate')}`, href: attentionHref(input.orgSlug, { kind: 'release', id: r.id }) },
    dueDate: r.targetDate!.slice(0, 10),
  };
}

function songItem(s: AttentionSong, input: AttentionInput): AttentionItem | null {
  if (!isStallableStage(s.stage)) return null;
  const days = daysSince(s.since, input.now);
  if (Number.isNaN(days) || days <= input.settings.attention_stalled_days) return null;
  const fallback: AttentionPerson = { id: null, name: s.artistName ?? 'Nobody' };
  const person = s.person ?? fallback;
  const stage = isSongStage(s.stage) ? SONG_STAGE_LABEL[s.stage] : String(s.stage);
  // The day it crossed the threshold orders songs against each other and against dated items.
  const crossed = new Date(Date.parse(s.since) + (input.settings.attention_stalled_days + 1) * DAY).toISOString().slice(0, 10);
  return {
    id: `song:${s.id}`,
    kind: 'song',
    severity: SEVERITY.song,
    title: s.title?.trim() || 'Untitled song',
    artistName: s.artistName,
    detail: `${stage} for ${plural(days, 'day')}`,
    person,
    people: [person],
    action: { verb: s.stage === 'in_development' ? 'Move it on' : 'Decide on it', href: attentionHref(input.orgSlug, { kind: 'song', id: s.id }) },
    dueDate: crossed,
  };
}

function taskItems(tasks: readonly AttentionTask[], input: AttentionInput): AttentionItem[] {
  const overdue = tasks.filter((t) => categorizeDue(t.dueAt, input.now.getTime()) === 'overdue');
  const byPerson = new Map<string, { person: AttentionPerson; tasks: AttentionTask[] }>();
  for (const t of overdue) {
    const person = t.assignee ?? t.creator ?? { id: null, name: 'Nobody' };
    const key = person.id ? person.id.toLowerCase() : 'none';
    const group = byPerson.get(key) ?? { person, tasks: [] };
    group.tasks.push(t);
    byPerson.set(key, group);
  }
  const out: AttentionItem[] = [];
  for (const [key, g] of byPerson) {
    // Oldest due date first: the first task is the one to open.
    const sorted = [...g.tasks].sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? '') || a.id.localeCompare(b.id));
    const worst = sorted[0];
    const days = Math.max(1, daysSince(worst.dueAt, input.now));
    const link = targetHref(input.orgSlug, worst.target) ?? attentionHref(input.orgSlug, { kind: 'tasks', id: key });
    out.push({
      id: `tasks:${key}`,
      kind: 'tasks',
      severity: SEVERITY.tasks,
      title: plural(sorted.length, 'overdue task'),
      artistName: null,
      detail: `${first(g.person.name)} · oldest: ${worst.title} (${plural(days, 'day')} late)`,
      person: g.person,
      people: [g.person],
      action: { verb: sorted.length === 1 ? 'Open the task' : 'Open the oldest', href: link },
      dueDate: worst.dueAt ? worst.dueAt.slice(0, 10) : null,
    });
  }
  return out;
}

/** Severity (high first), then due date (earliest first, undated last), then id. */
export function compareAttention(a: AttentionItem, b: AttentionItem): number {
  if (a.severity !== b.severity) return b.severity - a.severity;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  }
  return a.id.localeCompare(b.id);
}

export function computeAttention(input: AttentionInput): AttentionResult {
  const items: AttentionItem[] = [];
  let restricted = 0;

  for (const r of input.releases) {
    if (!inScope(input.artistScope, r.artistIds)) continue;
    const item = releaseItem(r, input);
    if (item) items.push(item);
  }
  for (const s of input.songs) {
    if (!inScope(input.artistScope, s.artistIds)) continue;
    const item = songItem(s, input);
    if (!item) continue;
    if (!s.readable) restricted += 1;
    else items.push(item);
  }
  items.push(...taskItems(input.tasks, input));

  return { items: items.sort(compareAttention), restricted };
}
