/**
 * Clause edits on a contract (LABEL-58). Pure. A contract snapshots the
 * clauses it was made from (LABEL-57); while it is a draft its wording can be
 * edited clause by clause. The same rules as the template editor apply
 * (ids, lengths, no unknown merge field), so a contract's clause set is always
 * one the renderer can fill.
 */
import { cleanTemplateEdit } from './template-edit';
import type { TemplateClause } from './templates';

export type ClauseInput = { id?: string; heading: string; body: string };
export type ClausesResult = { ok: true; clauses: TemplateClause[] } | { ok: false; error: string };

export function cleanContractClauses(input: readonly ClauseInput[]): ClausesResult {
  const res = cleanTemplateEdit({ name: 'contract', clauses: [...input] });
  return res.ok ? { ok: true, clauses: res.clauses } : { ok: false, error: res.error };
}

export type ClauseMark = 'same' | 'edited' | 'added';
export type ClauseMarks = { marks: Record<string, ClauseMark>; removed: TemplateClause[]; changed: number };

/** How each clause of `current` differs from the wording it started from. Removed clauses are listed apart. */
export function markClauses(base: readonly TemplateClause[], current: readonly TemplateClause[]): ClauseMarks {
  const prev = new Map(base.map((c) => [c.id, c]));
  const marks: Record<string, ClauseMark> = {};
  let changed = 0;
  for (const c of current) {
    const p = prev.get(c.id);
    marks[c.id] = !p ? 'added' : p.heading === c.heading && p.body === c.body ? 'same' : 'edited';
    if (marks[c.id] !== 'same') changed += 1;
  }
  const kept = new Set(current.map((c) => c.id));
  const removed = base.filter((c) => !kept.has(c.id));
  return { marks, removed, changed: changed + removed.length };
}
