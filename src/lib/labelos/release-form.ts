/**
 * The "New release" form and the release details, as plain functions
 * (LABEL-55). Pure: the screen holds the typed strings, these turn them into
 * what `POST|PATCH /api/org/[orgId]/releases` takes — the same shapes the
 * contract (`OrgReleaseCreateBodySchema`) and migration 175's CHECKs accept —
 * so a typo is named on the form instead of coming back as a 400.
 *
 * UPC is deliberately NOT checked here: the contract's `identifierField('upc')`
 * (lib/labelos/identifiers) is the one validator, and the server's own words
 * for a bad code are what the form shows.
 */

/** A release's most territories (175: 1..250 codes). */
export const MAX_TERRITORIES = 250;

export type TerritoriesResult = { ok: true; codes: string[] | null } | { ok: false; error: string };

/**
 * ISO 3166-1 alpha-2 codes (or WW for worldwide) typed separated by commas,
 * spaces or semicolons. Blank is "not stated" (null). Upper-cased, once each.
 */
export function parseTerritories(text: string): TerritoriesResult {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  if (parts.length === 0) return { ok: true, codes: null };
  const codes: string[] = [];
  for (const part of parts) {
    const code = part.toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) return { ok: false, error: `“${part}” is not a two-letter country code (use WW for worldwide).` };
    if (!codes.includes(code)) codes.push(code);
  }
  if (codes.includes('WW') && codes.length > 1) return { ok: false, error: 'WW means worldwide on its own; remove the other territories or WW.' };
  if (codes.length > MAX_TERRITORIES) return { ok: false, error: `A release names at most ${MAX_TERRITORIES} territories.` };
  return { ok: true, codes };
}

export const formatTerritories = (codes: readonly string[] | null | undefined): string => (codes && codes.length > 0 ? codes.join(', ') : '');

export type LanguageResult = { ok: true; code: string | null } | { ok: false; error: string };

/** A language code as 175 stores it: 2–3 lower-case letters, optionally a region ("pt-BR"). Blank is null. */
export function parseLanguage(text: string): LanguageResult {
  const v = text.trim();
  if (v === '') return { ok: true, code: null };
  if (!/^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/.test(v)) return { ok: false, error: 'Use a language code such as “en”, “pt-BR” or “zh-Hant-TW”.' };
  const [language, ...subtags] = v.split(/[-_]/);
  // BCP 47 casing: language lower, a two-letter region upper, a four-letter script capitalised.
  const tidy = (t: string) => (/^[A-Za-z]{2}$/.test(t) ? t.toUpperCase() : /^[A-Za-z]{4}$/.test(t) ? t[0].toUpperCase() + t.slice(1).toLowerCase() : t.toLowerCase());
  return { ok: true, code: [language.toLowerCase(), ...subtags.map(tidy)].join('-') };
}

export type NewReleaseForm = {
  title: string;
  contactId: string;
  type: string;
  labelName: string;
  upc: string;
  cLine: string;
  pLine: string;
  genre: string;
  territories: string;
  language: string;
  distributor: string;
  targetDate: string;
};

export type CreateBodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; field: string; error: string };

/** The create body from what was typed; empty fields are left out (the route stores NULL). */
export function buildReleaseCreateBody(form: NewReleaseForm): CreateBodyResult {
  const title = form.title.trim();
  if (!title) return { ok: false, field: 'title', error: 'Name the release.' };
  if (!form.contactId) return { ok: false, field: 'contact_id', error: 'Choose the artist.' };
  const body: Record<string, unknown> = { title, contact_id: form.contactId, type: form.type };
  const text = (key: string, value: string) => {
    const v = value.trim();
    if (v) body[key] = v;
  };
  text('label_name', form.labelName);
  text('upc', form.upc);
  text('c_line', form.cLine);
  text('p_line', form.pLine);
  text('primary_genre', form.genre);
  text('distributor', form.distributor);
  text('target_date', form.targetDate);
  const territories = parseTerritories(form.territories);
  if (!territories.ok) return { ok: false, field: 'territories', error: territories.error };
  if (territories.codes) body.territories = territories.codes;
  const language = parseLanguage(form.language);
  if (!language.ok) return { ok: false, field: 'language', error: language.error };
  if (language.code) body.language = language.code;
  return { ok: true, body };
}
