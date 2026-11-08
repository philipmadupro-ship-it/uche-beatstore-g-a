// The cast of the Label OS test accounts, shared by seed-test-accounts.mjs and
// remove-test-accounts.mjs so the remover deletes exactly what the seeder makes.
//
// NO PASSWORD IS HERE. Passwords come from the command line or a file the
// owner keeps outside the repository (see seed-test-accounts.mjs).
//
// `FUNCTIONS` is a copy of ORG_FUNCTIONS in src/lib/labelos/capabilities.ts;
// src/lib/labelos/test-accounts-model.test.ts fails if the two drift.

export const SEED_MARKER = 'bstudio-test-accounts';
export const DEFAULT_EMAIL_BASE = 'philipmadupro@gmail.com';

export const FUNCTIONS = [
  'a_and_r',
  'project_manager',
  'marketing',
  'legal',
  'finance',
  'artist_manager',
  'producer',
  'engineer',
  'operations',
  'pr',
  'executive',
  'artistic_director',
  'contracts',
];

export const ORGS = {
  label: { slug: 'test-label', name: 'BStudio Test Label', kind: 'label', owner: 'owner' },
  solo: { slug: 'test-artist-solo', name: 'Test Artist Solo', kind: 'artist', owner: 'artistowner' },
};

/** The label's roster artists: org contacts with the artist role, one login each. */
export const ROSTER = [
  { tag: 'artist1', name: 'Test Artist One' },
  { tag: 'artist2', name: 'Test Artist Two' },
];

// One Member per function (tag = the email tag), in capabilities.ts order.
const FUNCTION_TAGS = {
  a_and_r: 'ar',
  project_manager: 'projectmanager',
  marketing: 'marketing',
  legal: 'legal',
  finance: 'finance',
  artist_manager: 'artistmanager',
  producer: 'producer',
  engineer: 'engineer',
  operations: 'operations',
  pr: 'pr',
  executive: 'executive',
  artistic_director: 'artdirector',
  contracts: 'contracts',
};

/**
 * Every account. `org` is a key of ORGS or null; `role` is an org_members role;
 * `artists` are ROSTER tags the member is scoped to. Members join through the
 * app's own invitation functions, so each gets the same events and defaults a
 * real invitation would.
 */
export const ACCOUNTS = [
  { tag: 'owner', org: 'label', role: 'owner', functions: [], artists: [], note: 'Owner of BStudio Test Label' },
  { tag: 'admin', org: 'label', role: 'admin', functions: [], artists: [], note: 'Admin' },
  ...FUNCTIONS.map((fn) => ({
    tag: FUNCTION_TAGS[fn],
    org: 'label',
    role: 'member',
    functions: [fn],
    artists: [],
    note: `Member, function ${fn}`,
  })),
  {
    tag: 'arlimited',
    org: 'label',
    role: 'member',
    functions: ['a_and_r'],
    artists: ['artist1'],
    note: 'Member, function a_and_r, limited to Test Artist One',
  },
  ...ROSTER.map((r) => ({
    tag: r.tag,
    org: 'label',
    role: 'artist',
    functions: [],
    artists: [r.tag],
    note: `Roster artist ${r.name} (scoped to themselves)`,
  })),
  { tag: 'artistowner', org: 'solo', role: 'owner', functions: [], artists: [], note: 'Owner of Test Artist Solo (independent artist)' },
  { tag: 'stranger', org: null, role: null, functions: [], artists: [], note: 'Signed-in account with no organization' },
  { tag: 'buyer', org: null, role: null, functions: [], artists: [], note: 'Store buyer (no organization)' },
];

export function parseEmailBase(base) {
  const m = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})$/.exec(base ?? '');
  if (!m) throw new Error(`--email-base must be a plain address like name@example.com, got "${base}"`);
  return { local: m[1].toLowerCase(), domain: m[2].toLowerCase() };
}

export function emailFor(base, tag) {
  const { local, domain } = parseEmailBase(base);
  return `${local}+${tag}@${domain}`;
}

/** Single-quoted SQL literal. Rejects NUL; standard_conforming_strings makes '' the only escape. */
export function sqlLit(value) {
  const s = String(value);
  if (s.includes('\0')) throw new Error('NUL is not allowed in a SQL literal');
  return `'${s.replace(/'/g, "''")}'`;
}

export function sqlTextArray(values) {
  return values.length === 0 ? `ARRAY[]::text[]` : `ARRAY[${values.map(sqlLit).join(', ')}]::text[]`;
}

/** Parse `--name value` / `--name=value` flags. */
export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`);
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else {
        out[a.slice(2)] = next;
        i++;
      }
    }
  }
  return out;
}
