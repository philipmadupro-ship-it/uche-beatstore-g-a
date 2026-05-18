/**
 * Smart contact-import column mapping + parsing for CSV and XLSX files.
 *
 * Detects: name, email, phone, role, label, category, instagram, twitter,
 * website, country, city, genre, notes.
 *
 * Heuristics:
 *  - Case/whitespace-insensitive header matching with rich alias lists
 *  - Content sniffing fallback: emails → email, "@handle" → instagram,
 *    digit-heavy strings → phone, https → website
 *  - Auto-categorization from the role/category text using keyword rules
 *  - Per-row validation (email shape, phone min digits) returned alongside
 *    the parsed contact so the preview UI can flag bad rows
 */

const HEADER_ALIASES: Record<string, string[]> = {
  name: [
    'name', 'full name', 'fullname', 'contact', 'contact name',
    'artist', 'artist name', 'first name', 'display name', 'username',
  ],
  email: ['email', 'e-mail', 'mail', 'email address', 'contact email', 'work email', 'business email'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'cell phone', 'tel', 'telephone', 'number', 'contact number', 'whatsapp'],
  role: ['role', 'title', 'position', 'job', 'job title', 'occupation'],
  label: ['label', 'company', 'organization', 'org', 'team', 'agency', 'imprint'],
  category: ['category', 'type', 'kind'],
  genre: ['genre', 'genres', 'style', 'sound'],
  country: ['country', 'nation'],
  city: ['city', 'town', 'location', 'based in', 'based'],
  instagram: ['instagram', 'ig', 'insta', 'handle', 'instagram handle', 'ig handle', 'social'],
  twitter: ['twitter', 'x', 'twitter handle', 'x handle'],
  website: ['website', 'url', 'site', 'web', 'link'],
  notes: ['notes', 'note', 'comments', 'description', 'about', 'bio'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-\s]+/g, ' ').replace(/\s+/g, ' ');
}

export interface ColumnMap {
  name: number | null;
  email: number | null;
  phone: number | null;
  role: number | null;
  label: number | null;
  category: number | null;
  genre: number | null;
  country: number | null;
  city: number | null;
  instagram: number | null;
  twitter: number | null;
  website: number | null;
  notes: number | null;
}

export function inferColumnMap(headers: string[]): ColumnMap {
  const norm = headers.map(normalizeHeader);
  const map: ColumnMap = {
    name: null, email: null, phone: null, role: null, label: null,
    category: null, genre: null, country: null, city: null,
    instagram: null, twitter: null, website: null, notes: null,
  };
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (let i = 0; i < norm.length; i++) {
      if (aliases.some((a) => norm[i] === a)) {
        if ((map as any)[field] == null) (map as any)[field] = i;
      }
    }
    // Looser substring match if no exact hit
    if ((map as any)[field] == null) {
      for (let i = 0; i < norm.length; i++) {
        if (aliases.some((a) => norm[i].includes(a))) {
          if ((map as any)[field] == null) (map as any)[field] = i;
        }
      }
    }
  }
  return map;
}

// ───────── normalization helpers ─────────

export function cleanInstagram(v: string): string {
  return v
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
    .replace(/^instagram\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .trim();
}

export function cleanTwitter(v: string): string {
  return v
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(www\.)?(twitter|x)\.com\//i, '')
    .replace(/[/?#].*$/, '')
    .trim();
}

export function cleanWebsite(v: string): string {
  let s = v.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  return s;
}

export function cleanPhone(v: string): string {
  // Keep leading +, strip everything else but digits
  const trimmed = v.trim();
  if (!trimmed) return '';
  const plus = trimmed.startsWith('+') ? '+' : '';
  const digits = trimmed.replace(/\D/g, '');
  return digits ? plus + digits : '';
}

export function cleanEmail(v: string): string {
  return v.trim().toLowerCase();
}

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export function looksLikeHandle(v: string): boolean {
  return /^@[A-Za-z0-9_.]+$/.test(v.trim());
}

export function looksLikeUrl(v: string): boolean {
  return /^https?:\/\//i.test(v.trim()) || /\.(com|net|org|io|co|me|tv|fm|app)(\b|\/)/i.test(v.trim());
}

export function looksLikePhone(v: string): boolean {
  const digits = v.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /[\d\-\+\(\)\s]+/.test(v);
}

// ───────── auto categorization ─────────

const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/\b(manager|management|mgmt)\b/i, 'manager'],
  [/\b(a&?r|a-?r|artist\s*&?\s*repertoire)\b/i, 'a&r'],
  [/\b(producer|prod\.|beat\s*maker|beatmaker)\b/i, 'producer'],
  [/\b(label|imprint|records|recordings|distro|distribution)\b/i, 'label'],
  [/\b(engineer|mix(?:er|ing)?|master(?:ing|er))\b/i, 'engineer'],
  [/\b(dj)\b/i, 'dj'],
  [/\b(curator|playlist|tastemaker|blogger|editor|journalist|press|publicist|pr)\b/i, 'curator'],
  // `rapper` lands in the new "rapper" segment so the segment chips
  // light up after import. Generic vocal/songwriter terms fall through
  // to the legacy "artist" bucket — the row dropdown lets the user
  // promote them later.
  [/\b(rapper|mc|emcee|topliner|top-?line)\b/i, 'rapper'],
  [/\b(singer|songwriter|musician|vocalist|artist)\b/i, 'artist'],
];

export function inferCategory(...sources: (string | null | undefined)[]): string | null {
  const blob = sources.filter(Boolean).join(' ');
  if (!blob) return null;
  for (const [re, cat] of CATEGORY_RULES) if (re.test(blob)) return cat;
  return null;
}

// ───────── parsed contact + validation ─────────

export interface ParsedContact {
  name: string;
  email?: string;
  phone?: string;
  role?: string;
  label?: string;
  category?: string;
  genre?: string;
  country?: string;
  city?: string;
  instagram?: string;
  twitter?: string;
  website?: string;
  notes?: string;
}

export interface RowResult {
  contact: ParsedContact;
  warnings: string[];
  errors: string[];
}

function pick(row: any[], i: number | null): string {
  if (i == null) return '';
  return String(row[i] ?? '').trim();
}

export function rowsToContacts(headers: string[], rows: any[][]): ParsedContact[] {
  return rowsToResults(headers, rows).map((r) => r.contact);
}

export function rowsToResults(headers: string[], rows: any[][]): RowResult[] {
  const map = inferColumnMap(headers);
  const out: RowResult[] = [];

  for (const row of rows) {
    if (!row || row.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;

    const errors: string[] = [];
    const warnings: string[] = [];

    let name = pick(row, map.name);
    let email = pick(row, map.email);
    let phone = pick(row, map.phone);
    let instagram = pick(row, map.instagram);
    let twitter = pick(row, map.twitter);
    let website = pick(row, map.website);
    const role = pick(row, map.role);
    const label = pick(row, map.label);
    let category = pick(row, map.category);
    const genre = pick(row, map.genre);
    const country = pick(row, map.country);
    const city = pick(row, map.city);
    const notes = pick(row, map.notes);

    // Content sniffing fallback for missing columns
    const cells = row.map((c) => String(c ?? '').trim());

    if (!email) {
      const guess = cells.find(looksLikeEmail);
      if (guess) email = guess;
    }
    if (!instagram) {
      const guess = cells.find(looksLikeHandle);
      if (guess) instagram = cleanInstagram(guess);
    }
    if (!website) {
      const guess = cells.find((c) => looksLikeUrl(c) && !/instagram\.com|twitter\.com|x\.com/i.test(c));
      if (guess) website = cleanWebsite(guess);
    }
    if (!phone) {
      const guess = cells.find((c) => looksLikePhone(c) && !looksLikeEmail(c));
      if (guess) phone = cleanPhone(guess);
    }

    // Normalize values
    if (email) email = cleanEmail(email);
    if (phone) phone = cleanPhone(phone);
    if (instagram) instagram = cleanInstagram(instagram);
    if (twitter) twitter = cleanTwitter(twitter);
    if (website) website = cleanWebsite(website);

    // Auto-category if not provided
    if (!category) {
      const inferred = inferCategory(role, label, genre, notes);
      if (inferred) category = inferred;
    } else {
      category = category.toLowerCase();
    }

    // Need at least a name OR email to be useful
    if (!name && email) name = email.split('@')[0];
    if (!name && instagram) name = '@' + instagram;
    if (!name) {
      // Skip silently — totally empty row
      continue;
    }

    // Validation
    if (email && !looksLikeEmail(email)) {
      errors.push(`Invalid email: ${email}`);
      email = '';
    }
    if (phone && phone.replace(/\D/g, '').length < 7) {
      warnings.push(`Phone too short: ${phone}`);
    }

    out.push({
      contact: {
        name,
        email: email || undefined,
        phone: phone || undefined,
        role: role || undefined,
        label: label || undefined,
        category: category || undefined,
        genre: genre || undefined,
        country: country || undefined,
        city: city || undefined,
        instagram: instagram || undefined,
        twitter: twitter || undefined,
        website: website || undefined,
        notes: notes || undefined,
      },
      warnings,
      errors,
    });
  }
  return out;
}

// ───────── CSV parser ─────────

/** Parse a CSV string into rows. Handles quoted cells, escaped quotes, CRLF, and BOM. */
export function parseCSV(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else field += c;
    }
  }
  if (field.length || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.length && r.some((c) => c && String(c).trim()));
}
