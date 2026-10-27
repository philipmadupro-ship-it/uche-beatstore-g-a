/**
 * Renders a template's clauses with a contract's values (LABEL-57). Pure.
 *
 * A key with no value stays visible as `[Label]` and is reported in `missing`,
 * so a half-filled contract reads as half-filled rather than silently wrong.
 * Only party NAMES and ADDRESSES can be merged; no key exists for a tax id or
 * payment instructions.
 */
import { BUILTIN_SAMPLES, classifyKey, MERGE_FIELDS, mergeField, tokensIn, type BuiltinKey } from './merge-fields';
import { PARTY_ROLE_LABELS, type PartyRole } from './types';
import type { PartySlot, TemplateClause, TemplateDef } from './templates';

export type RenderParty = { name: string; address?: string | null };

export type RenderContext = {
  builtins: Partial<Record<BuiltinKey, string>>;
  parties: Partial<Record<PartyRole, RenderParty[]>>;
  fields: Record<string, string>;
};

export type RenderedClause = { id: string; heading: string; body: string };
export type Rendered = { clauses: RenderedClause[]; missing: string[] };

function labelFor(key: string): string {
  const k = classifyKey(key);
  if (!k) return key;
  if (k.type === 'field') return k.field.label;
  if (k.type === 'party') return `${PARTY_ROLE_LABELS[k.role]}${k.address ? ' address' : ''}`;
  return key.replace('.', ' ').replace(/_/g, ' ');
}

function valueOf(key: string, ctx: RenderContext): string | null {
  const k = classifyKey(key);
  if (!k) return null;
  if (k.type === 'field') return ctx.fields[key]?.trim() || null;
  if (k.type === 'builtin') return ctx.builtins[k.key]?.trim() || null;
  const list = (ctx.parties[k.role] ?? []).map((p) => (k.address ? p.address?.trim() : p.name.trim())).filter((v): v is string => !!v);
  return list.length ? list.join(k.address ? '; ' : ', ') : null;
}

export function renderClauses(clauses: readonly TemplateClause[], ctx: RenderContext): Rendered {
  const missing = new Set<string>();
  const fill = (text: string) =>
    text.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (_m, key: string) => {
      const v = valueOf(key, ctx);
      if (v !== null) return v;
      missing.add(key);
      return `[${labelFor(key)}]`;
    });
  return { clauses: clauses.map((c) => ({ id: c.id, heading: fill(c.heading), body: fill(c.body) })), missing: [...missing] };
}

/** The typed fields a clause set asks for, in the order they first appear. */
export function fieldKeysOf(clauses: readonly TemplateClause[]): string[] {
  const seen: string[] = [];
  for (const c of clauses) for (const k of tokensIn(`${c.heading}\n${c.body}`)) if (classifyKey(k)?.type === 'field' && !seen.includes(k)) seen.push(k);
  return seen;
}

/** Sample values for the template preview (and tests): every key a template can ask for gets one. */
export function sampleContext(slots: readonly PartySlot[]): RenderContext {
  const parties: RenderContext['parties'] = {};
  for (const s of slots) {
    parties[s.role] = (s.many ? [1, 2] : [1]).map((n) => ({ name: `Sample ${PARTY_ROLE_LABELS[s.role]}${s.many ? ` ${n}` : ''}`, address: '1 Example Street, Sampletown' }));
  }
  return { builtins: { ...BUILTIN_SAMPLES }, parties, fields: Object.fromEntries(MERGE_FIELDS.map((f) => [f.key, f.sample])) };
}

export function renderSample(t: Pick<TemplateDef, 'slots' | 'clauses'>): Rendered {
  return renderClauses(t.clauses, sampleContext(t.slots));
}

export { mergeField };
