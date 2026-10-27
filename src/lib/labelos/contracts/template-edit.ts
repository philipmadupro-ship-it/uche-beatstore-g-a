/**
 * Template editor rules (LABEL-57). Pure. An organization's template is a
 * versioned lineage per type: the first edit of a platform default saves
 * version 1 of the org's own copy, every later edit saves the next version.
 * Rows are never rewritten, so a contract made from version N keeps N's words.
 */
import { unknownTokens } from './merge-fields';
import type { TemplateClause } from './templates';

export const CLAUSES_MAX = 60;
export const HEADING_MAX = 120;
export const BODY_MAX = 6000;
export const NAME_MAX = 120;
export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export type EditInput = { name: string; clauses: { id?: string; heading: string; body: string }[] };
export type EditResult = { ok: true; name: string; clauses: TemplateClause[] } | { ok: false; error: string };

/** Normalises an edit: trims, mints ids for new clauses, refuses unknown merge fields and over-long text. */
export function cleanTemplateEdit(input: EditInput): EditResult {
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, error: 'A template needs a name' };
  if (name.length > NAME_MAX) return { ok: false, error: `The name is too long (${NAME_MAX} characters at most)` };
  if (input.clauses.length === 0) return { ok: false, error: 'A template needs at least one clause' };
  if (input.clauses.length > CLAUSES_MAX) return { ok: false, error: `A template holds at most ${CLAUSES_MAX} clauses` };
  const used = new Set<string>();
  const out: TemplateClause[] = [];
  for (const [i, c] of input.clauses.entries()) {
    const heading = c.heading.trim();
    const body = c.body.replace(/\r\n/g, '\n').trim();
    if (!heading) return { ok: false, error: `Clause ${i + 1} needs a heading` };
    if (heading.length > HEADING_MAX) return { ok: false, error: `Clause ${i + 1}: the heading is too long` };
    if (!body) return { ok: false, error: `Clause ${i + 1} needs text` };
    if (body.length > BODY_MAX) return { ok: false, error: `Clause ${i + 1}: the text is too long (${BODY_MAX} characters at most)` };
    const unknown = [...unknownTokens(heading), ...unknownTokens(body)];
    if (unknown.length) return { ok: false, error: `Clause ${i + 1} uses merge fields that do not exist: ${[...new Set(unknown)].map((k) => `{{${k}}}`).join(', ')}` };
    let id = c.id && ID_PATTERN.test(c.id) ? c.id : '';
    if (!id || used.has(id)) {
      let n = i + 1;
      while (used.has(`clause-${n}`)) n += 1;
      id = `clause-${n}`;
    }
    used.add(id);
    out.push({ id, heading, body });
  }
  return { ok: true, name, clauses: out };
}

/** Same clauses, in the same order, with the same words? An edit that changes nothing saves no version. */
export function sameClauses(a: readonly TemplateClause[], b: readonly TemplateClause[]): boolean {
  return a.length === b.length && a.every((c, i) => c.id === b[i].id && c.heading === b[i].heading && c.body === b[i].body);
}

/** Which clause ids changed, were added or removed: the event payload names ids, never words. */
export function changedClauseIds(before: readonly TemplateClause[], after: readonly TemplateClause[]): string[] {
  const prev = new Map(before.map((c) => [c.id, c]));
  const next = new Map(after.map((c) => [c.id, c]));
  const ids = new Set<string>();
  for (const [id, c] of next) {
    const p = prev.get(id);
    if (!p || p.heading !== c.heading || p.body !== c.body) ids.add(id);
  }
  for (const id of prev.keys()) if (!next.has(id)) ids.add(id);
  return [...ids];
}
