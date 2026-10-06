/**
 * Replays every migration's CREATE/DROP POLICY and RLS switches in order and
 * asserts on the resulting state. RLS is only as strong as the LAST migration
 * that touched a policy, and a single missed table (arrangements survived
 * 097's owner-only sweep for 100 migrations) is invisible in a file-by-file
 * review.
 *
 * The replay is static: it sees policies written literally in a migration,
 * not ones built with EXECUTE format(...). Label OS migrations write theirs
 * literally so these guards can see them. Runtime behaviour is proven on a
 * real database by `npm run db:local:check` (supabase/local/checks/).
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'supabase/migrations');

type Migration = { name: string; sql: string };
type ReplayState = {
  /** `table.policy` → normalised body (FOR … USING … WITH CHECK …). */
  policies: Map<string, string>;
  /** Final RLS switch per table: true = ENABLE, false = DISABLE. */
  rls: Map<string, boolean>;
  /** Tables some migration creates. */
  created: Set<string>;
  /** Migrations that call is_team_member(), the dormant 001 team model. */
  teamMemberCallers: string[];
  /** `table.policy` for every ALTER POLICY; the replay cannot model its effect. */
  altered: Set<string>;
};

function realMigrations(): Migration[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8') }));
}

const POLICY_RE = /(DROP POLICY IF EXISTS|DROP POLICY|CREATE POLICY)\s+("[^"]+"|\S+)\s+ON\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
const RLS_RE =
  /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:public\.)?"?(\w+)"?\s+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY/gi;
const ALTER_POLICY_RE = /ALTER\s+POLICY\s+("[^"]+"|\S+)\s+ON\s+(?:public\.)?"?(\w+)"?/gi;
const CREATE_TABLE_RE = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)"?/gi;

/** Replays migrations in order; later statements win, as they do in Postgres. */
function replay(migrations: Migration[]): ReplayState {
  const state: ReplayState = { policies: new Map(), rls: new Map(), created: new Set(), teamMemberCallers: [], altered: new Set() };
  for (const { name, sql: raw } of migrations) {
    const sql = raw.replace(/--[^\n]*/g, '');
    if (/\bis_team_member\s*\(/i.test(sql)) state.teamMemberCallers.push(name);
    for (const m of sql.matchAll(CREATE_TABLE_RE)) state.created.add(m[1]);
    for (const m of sql.matchAll(ALTER_POLICY_RE)) state.altered.add(`${m[2]}.${m[1].replace(/"/g, '')}`);
    // Policies and RLS switches interleave within a file; apply them in source order.
    const events = [
      ...[...sql.matchAll(POLICY_RE)].map((m) => ({ at: m.index ?? 0, apply: () => applyPolicy(state, m) })),
      ...[...sql.matchAll(RLS_RE)].map((m) => ({
        at: m.index ?? 0,
        apply: () => state.rls.set(m[1], m[2].toUpperCase() === 'ENABLE'),
      })),
    ].sort((a, b) => a.at - b.at);
    for (const e of events) e.apply();
  }
  return state;
}

function applyPolicy(state: ReplayState, m: RegExpMatchArray) {
  const key = `${m[3]}.${m[2].replace(/"/g, '')}`;
  if (m[1].toUpperCase().startsWith('DROP')) state.policies.delete(key);
  else state.policies.set(key, m[4].replace(/\s+/g, ' '));
}

function finalPolicies(): Map<string, string> {
  return replay(realMigrations()).policies;
}

// ── Label OS guards (LABEL-04) ───────────────────────────────────────────

/**
 * Every table Label OS creates. ADD A TABLE HERE IN THE MIGRATION'S OWN PR —
 * a table missing from this list is not guarded. A listed table that no
 * migration creates fails, so a typo cannot silently guard nothing.
 */
function labelOsTables(): string[] {
  return [
    // 136_labelos_org_core.sql (LABEL-03)
    'organizations',
    'org_members',
    'org_invitations',
    'user_profiles',
    'activity_events',
    // 139_labelos_org_contacts.sql (LABEL-10)
    'member_artist_scopes',
    // 144_labelos_releases.sql (LABEL-16)
    'releases',
    'release_items',
    // 148_labelos_project_members.sql (LABEL-21)
    'project_members',
  ];
}

/**
 * The SQL membership helpers a Label OS policy may key on
 * (06-permission-model.md §3.1). can_see_artist arrived with LABEL-10;
 * can_see_org_project / can_see_org_track / can_read_org_track with LABEL-12;
 * can_see_project with LABEL-21.
 */
const ORG_HELPERS = [
  'org_role',
  'has_org_cap',
  'can_see_artist',
  'can_see_org_project',
  'can_see_org_track',
  'can_read_org_track',
  'can_see_project',
  // 147 (LABEL-20): the projects an artists-scoped member's scope reaches, for activity_events.
  'labelos_scoped_projects',
];
const ORG_HELPER_CALL = new RegExp(`\\b(${ORG_HELPERS.join('|')})\\s*\\(`, 'i');

/**
 * A Label OS policy must key on the tenant: a membership helper on the row's
 * `org_id` (or on a parent row's, inside an EXISTS — a child table such as
 * release_items reaches its org through its parent), or, without a helper,
 * `org_id` tied to the caller through `auth.uid()`. A policy keyed only on
 * `user_id = auth.uid()` is the producer app's tenancy and is wrong here: it
 * ignores which org the row is in. A bare `org_id` mention is not enough:
 * `org_id IS NOT NULL` admits everyone.
 */
function keysOnOrg(body: string): boolean {
  if (ORG_HELPERS.some((h) => new RegExp(`\\b${h}\\s*\\(`, 'i').test(body))) return true;
  // A bare org_id mention is not tenancy (`org_id IS NOT NULL` lets every
  // user in); without a helper it must be tied to the caller via auth.uid().
  return /\borg_id\b/i.test(body) && /\bauth\.uid\s*\(/i.test(body);
}

const OPEN_PREDICATE = /(USING|WITH CHECK)\s*\(\s*true\s*\)/i;

/** Every way the listed tables break the Label OS rules; empty = clean. */
function labelOsViolations(state: ReplayState, tables: string[]): string[] {
  const out: string[] = [];
  for (const table of tables) {
    if (!state.created.has(table)) out.push(`${table}: no migration creates it (typo in labelOsTables()?)`);
    if (state.rls.get(table) !== true) out.push(`${table}: row level security is not enabled`);
    for (const key of state.altered) {
      if (key.startsWith(`${table}.`)) out.push(`${key}: ALTER POLICY (write DROP POLICY + CREATE POLICY so the replay sees it)`);
    }
    for (const [key, body] of state.policies) {
      if (!key.startsWith(`${table}.`)) continue;
      if (OPEN_PREDICATE.test(body)) out.push(`${key}: USING (true) / WITH CHECK (true)`);
      if (!keysOnOrg(body)) out.push(`${key}: no org_id, membership helper or parent-EXISTS predicate`);
    }
  }
  return out;
}

/**
 * The only migrations allowed to call is_team_member(): the dormant 001 team
 * model and 003, from before owner-only RLS. Label OS replaces that model; a
 * new caller would revive "any team member sees everything".
 */
const TEAM_MEMBER_CALLERS_ALLOWED = ['001_init.sql', '003_vault_domain.sql'];

describe('final RLS policy state', () => {
  const policies = finalPolicies();

  it('parses a realistic number of policies', () => {
    expect(policies.size).toBeGreaterThan(50);
  });

  it('never lets an authenticated user insert their own creator_profiles row', () => {
    // A profile row IS the producer marker (requireProducer, src/proxy.ts).
    const inserts = [...policies].filter(
      ([k, body]) => k.startsWith('creator_profiles.') && /FOR\s+(INSERT|ALL)/i.test(body),
    );
    expect(inserts).toEqual([]);
  });

  it('no direct-row policy admits a NULL owner (mig 097)', () => {
    // `user_id IS NULL` on the table itself is also true for the anon role.
    // Child "via parent" policies are excluded: their EXISTS subquery runs
    // under the parent's owner-only RLS, which already hides null parents.
    const offenders = [...policies]
      .filter(([, body]) => /user_id\s+IS\s+NULL/i.test(body) && !/EXISTS/i.test(body))
      .map(([k]) => k);
    expect(offenders).toEqual([]);
  });

  it('no table is writable by everyone except append-only telemetry', () => {
    const openWrites = [...policies]
      .filter(([, body]) => /(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(body) && !/FOR\s+SELECT/i.test(body))
      .map(([k]) => k)
      .sort();
    expect(openWrites).toEqual(['play_head_pings.play_head_pings_insert', 'share_plays.public insert play']);
  });

  it('catalogue writes through RLS require the producer, not just any session', () => {
    // Buyers hold Supabase sessions; owner_only alone let them insert
    // store-listed tracks pointing at private audio (mig 119).
    for (const table of ['tracks', 'projects', 'playlists']) {
      const body = policies.get(`${table}.owner_only`) ?? '';
      expect(body, table).toMatch(/WITH CHECK[\s\S]*is_producer\(\)/i);
    }
  });

  describe('Label OS org core (mig 136)', () => {
    const onTable = (table: string) => [...policies].filter(([k]) => k.startsWith(`${table}.`));

    it('every org-core table has at least one policy', () => {
      for (const table of labelOsTables()) expect(onTable(table).length, table).toBeGreaterThan(0);
    });

    it('activity_events is append-only: no UPDATE, DELETE or ALL policy', () => {
      const writes = onTable('activity_events')
        .filter(([, body]) => /FOR\s+(UPDATE|DELETE|ALL)\b/i.test(body))
        .map(([k]) => k);
      expect(writes).toEqual([]);
    });

    it('activity_events has ONE policy, a SELECT, and it carries catalog.read, the internal class AND the artist scope (147, LABEL-20)', () => {
      expect(onTable('activity_events').map(([k]) => k)).toEqual(['activity_events.activity_events_member_read']);
      const body = policies.get('activity_events.activity_events_member_read') ?? '';
      expect(body).toMatch(/^\s*FOR SELECT\b/i);
      expect(body).toMatch(/has_org_cap\(org_id, 'catalog\.read'\)/);
      expect(body).toMatch(/visibility = 'artist' OR[\s\S]*has_org_cap\(org_id, 'business\.read\.internal'\)/);
      // Without these a member limited to some artists (or a roster artist) reads every artist's events with their own JWT.
      expect(body).toMatch(/\(org_id, artist_id\) IN \(\s*SELECT s\.org_id, s\.contact_id FROM public\.member_artist_scopes s WHERE s\.user_id = \(SELECT auth\.uid\(\)\)/);
      expect(body).toMatch(/artist_id IS NULL AND project_id IS NOT NULL AND \(org_id, project_id\) IN \(SELECT sp\.org_id, sp\.project_id FROM public\.labelos_scoped_projects\(\) sp\)/);
      expect(body).not.toMatch(/WITH CHECK/i);
    });

    it('activity_events scope makes no per-row SECURITY DEFINER call: every scope disjunct is an uncorrelated subquery (R-08)', () => {
      const body = policies.get('activity_events.activity_events_member_read') ?? '';
      expect(body).toMatch(/org_id IN \(\s*SELECT om\.org_id FROM public\.org_members om WHERE om\.user_id = \(SELECT auth\.uid\(\)\)/);
      // The only has_org_cap calls are 136's two capability tests; scope adds no helper call keyed on the row.
      expect([...body.matchAll(/has_org_cap\(/g)]).toHaveLength(2);
      expect(body).not.toMatch(/can_see_artist\(|can_see_org_project\(|can_see_org_track\(/);
    });

    it('org_members has no insert policy: joining is the service-role accept route only', () => {
      const inserts = onTable('org_members')
        .filter(([, body]) => /FOR\s+(INSERT|ALL)\b/i.test(body))
        .map(([k]) => k);
      expect(inserts).toEqual([]);
    });

    it('org_members writes require members.manage', () => {
      const writes = onTable('org_members').filter(([, body]) => /FOR\s+(UPDATE|DELETE)\b/i.test(body));
      expect(writes.length).toBeGreaterThan(0);
      for (const [k, body] of writes) expect(body, k).toMatch(/has_org_cap\s*\(\s*org_id\s*,\s*'members\.manage'\s*\)/);
    });
  });

  describe('Label OS org contacts (mig 139, R-04)', () => {
    const before139 = replay(realMigrations().filter((m) => m.name < '139')).policies;
    const onContacts = () => [...policies].filter(([k]) => k.startsWith('contacts.'));

    it('contacts has exactly the producer policy and the one additive org policy', () => {
      expect(onContacts().map(([k]) => k).sort()).toEqual(['contacts.org_member_read', 'contacts.owner_only']);
    });

    it("the producer's owner_only policy is exactly what it was before Label OS touched contacts", () => {
      expect(policies.get('contacts.owner_only')).toBe(before139.get('contacts.owner_only'));
      expect(policies.get('contacts.owner_only')).toMatch(/FOR ALL USING \(\(SELECT auth\.uid\(\)\) = user_id\)/);
    });

    it('org_member_read is read-only and requires org_id IS NOT NULL, catalog.read and the artist scope', () => {
      const body = policies.get('contacts.org_member_read') ?? '';
      expect(body).toMatch(/^\s*FOR SELECT\b/i);
      expect(body).toMatch(/USING \(\s*org_id IS NOT NULL\s+AND/i);
      expect(body).toMatch(/has_org_cap\(org_id, 'catalog\.read'\)/);
      expect(body).toMatch(/can_see_artist\(org_id, id\)/);
      expect(body).not.toMatch(/\bOR\b/i);
      expect(body).not.toMatch(/WITH CHECK/i);
    });

    it('member_artist_scopes has no write policy: scope changes only through the service role', () => {
      const writes = [...policies]
        .filter(([k, body]) => k.startsWith('member_artist_scopes.') && /FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(body))
        .map(([k]) => k);
      expect(writes).toEqual([]);
    });

    it('every org policy on a table that predates Label OS requires org_id IS NOT NULL (R-04)', () => {
      // A permissive policy is OR-combined with the producer's: on tracks,
      // projects, contacts… an org predicate that does not rule out producer
      // rows (org_id IS NULL) would hand them to members.
      const guarded = new Set(labelOsTables());
      const offenders = [...policies]
        .filter(([k, body]) => !guarded.has(k.split('.')[0]) && ORG_HELPER_CALL.test(body) && !/\borg_id IS NOT NULL\b/i.test(body))
        .map(([k]) => k);
      expect(offenders).toEqual([]);
    });
  });

  describe('Label OS org catalogue (mig 141, R-04)', () => {
    const before141 = replay(realMigrations().filter((m) => m.name < '141')).policies;
    const ORG_READ_TABLES = [
      'tracks',
      'projects',
      'project_contacts',
      'artist_portals',
      'project_assets',
      'song_beats',
      'track_links',
      'artist_messages',
      'contact_track_states',
      'project_comments',
    ];
    /** Every table with an org read path is guarded with its predicate. */
    const GUARDED_TABLES = ORG_READ_TABLES;
    /** Keyed through a track's / project's user_id, with no org read path: org rows hidden. */
    const HIDDEN_TABLES = [
      'project_tracks',
      'project_shares',
      'track_versions',
      'track_collaborators',
      'track_licenses',
      'play_head_pings',
      'store_free_downloads',
      'project_tags',
      'project_folder_items',
      'project_access_links',
    ];
    const ALL_141 = [...ORG_READ_TABLES, ...HIDDEN_TABLES];

    it('every producer policy on these tables is exactly what it was before 141', () => {
      for (const [key, body] of before141) {
        if (!ALL_141.includes(key.split('.')[0])) continue;
        expect(policies.get(key), key).toBe(body);
      }
    });

    it('141 adds exactly org_member_read on each org-readable table and org_member_guard wherever an owner policy could reach an org row', () => {
      const added = [...policies.keys()].filter((k) => ALL_141.includes(k.split('.')[0]) && !before141.has(k)).sort();
      expect(added).toEqual(
        [...ORG_READ_TABLES.map((t) => `${t}.org_member_read`), ...ALL_141.map((t) => `${t}.org_member_guard`)].sort(),
      );
    });

    it('every org_member_read is a permissive SELECT keyed on org_id IS NOT NULL (on the row or, in EXISTS, its parent) and a membership helper', () => {
      for (const table of ORG_READ_TABLES) {
        const body = policies.get(`${table}.org_member_read`) ?? '';
        expect(body, table).toMatch(/^\s*FOR SELECT\s+TO authenticated\s+USING\b/i);
        expect(body, table).toMatch(/\borg_id IS NOT NULL\b/i);
        expect(body, table).toMatch(ORG_HELPER_CALL);
        expect(body, table).not.toMatch(/WITH CHECK/i);
        expect(body, table).not.toMatch(/auth\.uid\s*\(/i);
        if (!['tracks', 'projects'].includes(table)) expect(body, table).toMatch(/^[^(]*USING \(\s*EXISTS\s*\(/i);
      }
    });

    it('tracks and projects test org_id IS NOT NULL on the row itself, first', () => {
      for (const table of ['tracks', 'projects']) {
        expect(policies.get(`${table}.org_member_read`)).toMatch(/USING \(\s*org_id IS NOT NULL\s+AND/i);
      }
      expect(policies.get('tracks.org_member_read')).toMatch(/can_read_org_track\(org_id, id\)/);
      expect(policies.get('projects.org_member_read')).toMatch(/can_see_org_project\(org_id, id\)/);
    });

    it('every guard is a RESTRICTIVE SELECT that lets a producer row through and holds an org row to the read predicate', () => {
      for (const table of GUARDED_TABLES) {
        const body = policies.get(`${table}.org_member_guard`) ?? '';
        expect(body, table).toMatch(/^\s*AS RESTRICTIVE\s+FOR SELECT\s+USING\b/i);
        expect(body, table).toMatch(/\borg_id IS NOT NULL\b/i);
        expect(body, table).toMatch(ORG_HELPER_CALL);
        expect(body, table).not.toMatch(/WITH CHECK/i);
        // Producer rows pass: the row's own org_id IS NULL, or a SECURITY
        // DEFINER "is it an org row" helper (never an EXISTS under RLS).
        expect(body, table).toMatch(/USING \(\s*(org_id IS NULL\s+OR|\(?NOT public\.labelos_is_org_(project|track|contact)\()/i);
      }
    });

    it('on tables with no org read path, the guard hides org rows outright', () => {
      for (const table of HIDDEN_TABLES) {
        const body = policies.get(`${table}.org_member_guard`) ?? '';
        expect(body, table).toMatch(/^\s*AS RESTRICTIVE\s+FOR SELECT\s+USING \(\s*NOT public\.labelos_is_org_(project|track)\(/i);
        expect(body, table).not.toMatch(/\bOR\b/i);
      }
    });

    it('no org policy writes: nothing new is FOR INSERT / UPDATE / DELETE / ALL', () => {
      const writes = [...policies]
        .filter(([k, body]) => /\.org_member_(read|guard)$/.test(k) && /FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i.test(body))
        .map(([k]) => k);
      expect(writes).toEqual([]);
    });
  });

  describe('Label OS org files (mig 143, LABEL-15)', () => {
    const before143 = replay(realMigrations().filter((m) => m.name < '143')).policies;

    it('project_assets keeps its producer policies; read and guard hold sensitivity and the kind class', () => {
      for (const name of ['project_assets_owner_select', 'project_assets_owner_write']) {
        expect(policies.get(`project_assets.${name}`), name).toBe(before143.get(`project_assets.${name}`));
      }
      for (const name of ['org_member_read', 'org_member_guard']) {
        const body = policies.get(`project_assets.${name}`) ?? '';
        expect(body, name).toMatch(/labelos_org_asset_allowed\(p\.org_id, project_assets\.kind, project_assets\.sensitivity\)/);
        expect(body, name).toMatch(/can_see_org_project\(p\.org_id, p\.id\)/);
        expect(body, name).not.toMatch(/kind IN \('artwork', 'lyrics'\)/);
      }
    });

    it('track_stem_files gains only a guard that hides org rows; its owner policy is unchanged', () => {
      expect(policies.get('track_stem_files.track_stem_files_owner')).toBe(before143.get('track_stem_files.track_stem_files_owner'));
      expect(before143.has('track_stem_files.org_member_guard')).toBe(false);
      expect(policies.get('track_stem_files.org_member_guard')).toMatch(
        /^\s*AS RESTRICTIVE\s+FOR SELECT\s+USING \(\s*NOT public\.labelos_is_org_track\(track_id\)\s*\)\s*$/i,
      );
    });
  });

  describe('Label OS external project members (mig 148, LABEL-21)', () => {
    const before148 = replay(realMigrations().filter((m) => m.name < '148')).policies;
    const onMembers = () => [...policies].filter(([k]) => k.startsWith('project_members.'));

    it('project_members has exactly two policies, both SELECT: own live row, or share.external on the row\'s org', () => {
      expect(onMembers().map(([k]) => k).sort()).toEqual(['project_members.project_members_manage_read', 'project_members.project_members_self_read']);
      for (const [k, body] of onMembers()) {
        expect(body, k).toMatch(/^\s*FOR SELECT\b/i);
        expect(body, k).not.toMatch(/FOR\s+(INSERT|UPDATE|DELETE|ALL)\b/i);
        expect(body, k).not.toMatch(/WITH CHECK/i);
      }
      expect(policies.get('project_members.project_members_self_read')).toMatch(/user_id = \(SELECT auth\.uid\(\)\)\s+AND \(SELECT public\.can_see_project\(project_id\)\)/);
      expect(policies.get('project_members.project_members_manage_read')).toMatch(/has_org_cap\(org_id, 'share\.external'\)/);
    });

    it('148 gives an external member NO read path to anything: every other policy is exactly what it was', () => {
      // The material an external member works on is read through the service
      // role routes (externalCan); no policy on any other table mentions
      // project_members or can_see_project, so their own JWT reads none of it.
      for (const [key, body] of before148) expect(policies.get(key), key).toBe(body);
      const added = [...policies.keys()].filter((k) => !before148.has(k) && !k.startsWith('project_members.'));
      expect(added).toEqual([]);
      const mentions = [...policies]
        .filter(([k, body]) => !k.startsWith('project_members.') && /project_members|can_see_project\s*\(/.test(body))
        .map(([k]) => k);
      expect(mentions).toEqual([]);
    });
  });

  it('share_links writes through RLS require the producer', () => {
    for (const name of ['share_links_owner_insert', 'share_links_owner_update']) {
      expect(policies.get(`share_links.${name}`) ?? '', name).toMatch(/WITH CHECK[\s\S]*is_producer\(\)/i);
    }
  });
});

describe('Label OS RLS guards (LABEL-04)', () => {
  const real = realMigrations();
  const realState = replay(real);

  /** Real migrations plus fixture files that sort after them. */
  const withFixture = (...files: Migration[]) => replay([...real, ...files]);
  const fx = (name: string, sql: string): Migration => ({ name: `999_fixture_${name}.sql`, sql });

  it('the real migrations pass every Label OS guard', () => {
    expect(labelOsViolations(realState, labelOsTables())).toEqual([]);
  });

  it('the replay sees the real RLS switches (sanity)', () => {
    for (const table of labelOsTables()) expect(realState.rls.get(table), table).toBe(true);
    expect(realState.rls.get('tracks')).toBe(true);
  });

  it('no new migration calls is_team_member()', () => {
    expect(realState.teamMemberCallers).toEqual(TEAM_MEMBER_CALLERS_ALLOWED);
  });

  describe('a deliberately bad fixture migration fails each guard', () => {
    const GOOD = `
      CREATE TABLE IF NOT EXISTS public.lo_fixture (id uuid PRIMARY KEY, org_id uuid NOT NULL, user_id uuid);
      ALTER TABLE public.lo_fixture ENABLE ROW LEVEL SECURITY;
      CREATE POLICY lo_fixture_read ON public.lo_fixture
        FOR SELECT USING ((SELECT public.org_role(org_id)) IS NOT NULL);
    `;
    // Fixture assertions look at the fixture tables only, so a problem in a
    // real migration fails one test (above), not every fixture case.
    const tables = ['lo_fixture'];

    it('control: a well-formed Label OS table passes', () => {
      expect(labelOsViolations(withFixture(fx('good', GOOD)), tables)).toEqual([]);
    });

    it('RLS never enabled', () => {
      const state = withFixture(
        fx('no_rls', GOOD.replace('ALTER TABLE public.lo_fixture ENABLE ROW LEVEL SECURITY;', '')),
      );
      expect(labelOsViolations(state, tables)).toEqual(['lo_fixture: row level security is not enabled']);
    });

    it('RLS enabled, then disabled by a later migration', () => {
      const state = withFixture(fx('a_good', GOOD), fx('b_disable', 'ALTER TABLE lo_fixture DISABLE ROW LEVEL SECURITY;'));
      expect(labelOsViolations(state, tables)).toEqual(['lo_fixture: row level security is not enabled']);
    });

    it('a USING (true) policy', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx('b_open', `CREATE POLICY lo_fixture_open ON public.lo_fixture FOR SELECT USING (true);`),
      );
      expect(labelOsViolations(state, tables)).toContain('lo_fixture.lo_fixture_open: USING (true) / WITH CHECK (true)');
    });

    it('a WITH CHECK (true) policy keyed on org_id elsewhere', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx(
          'b_open_check',
          `CREATE POLICY lo_fixture_ins ON public.lo_fixture FOR INSERT
             WITH CHECK (true);
           CREATE POLICY lo_fixture_upd ON public.lo_fixture FOR UPDATE
             USING (org_id IS NOT NULL) WITH CHECK ( true );`,
        ),
      );
      const v = labelOsViolations(state, tables);
      expect(v).toContain('lo_fixture.lo_fixture_ins: USING (true) / WITH CHECK (true)');
      expect(v).toContain('lo_fixture.lo_fixture_upd: USING (true) / WITH CHECK (true)');
    });

    it('a policy that mentions org_id without tying it to the caller', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx('b_any', `CREATE POLICY lo_fixture_any ON public.lo_fixture FOR SELECT USING (org_id IS NOT NULL);`),
      );
      expect(labelOsViolations(state, tables)).toEqual([
        'lo_fixture.lo_fixture_any: no org_id, membership helper or parent-EXISTS predicate',
      ]);
    });

    it('an ALTER POLICY on a guarded table', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx('b_alter', `ALTER POLICY lo_fixture_read ON public.lo_fixture USING (true);`),
      );
      expect(labelOsViolations(state, tables)).toEqual([
        'lo_fixture.lo_fixture_read: ALTER POLICY (write DROP POLICY + CREATE POLICY so the replay sees it)',
      ]);
    });

    it('a policy keyed on user_id only (producer-app tenancy)', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx('b_user', `CREATE POLICY lo_fixture_mine ON public.lo_fixture FOR ALL USING (auth.uid() = user_id);`),
      );
      expect(labelOsViolations(state, tables)).toEqual([
        'lo_fixture.lo_fixture_mine: no org_id, membership helper or parent-EXISTS predicate',
      ]);
    });

    it('a good policy replaced by a bad one under the same name (last write wins)', () => {
      const state = withFixture(
        fx('a_good', GOOD),
        fx(
          'b_replace',
          `DROP POLICY IF EXISTS lo_fixture_read ON public.lo_fixture;
           CREATE POLICY lo_fixture_read ON public.lo_fixture FOR SELECT USING (auth.uid() IS NOT NULL);`,
        ),
      );
      expect(labelOsViolations(state, tables)).toEqual([
        'lo_fixture.lo_fixture_read: no org_id, membership helper or parent-EXISTS predicate',
      ]);
    });

    it('a child table keyed through its parent passes; one keyed through a producer table does not', () => {
      const child = `
        CREATE TABLE public.lo_child (id uuid PRIMARY KEY, parent_id uuid, track_id uuid);
        ALTER TABLE public.lo_child ENABLE ROW LEVEL SECURITY;
        CREATE POLICY lo_child_via_parent ON public.lo_child FOR SELECT USING (EXISTS (
          SELECT 1 FROM public.lo_fixture p
          WHERE p.id = lo_child.parent_id AND (SELECT public.has_org_cap(p.org_id, 'catalog.read'))));
        CREATE POLICY lo_child_via_track ON public.lo_child FOR SELECT USING (EXISTS (
          SELECT 1 FROM public.tracks t WHERE t.id = lo_child.track_id AND t.user_id = auth.uid()));
      `;
      const state = withFixture(fx('a_good', GOOD), fx('b_child', child));
      expect(labelOsViolations(state, [...tables, 'lo_child'])).toEqual([
        'lo_child.lo_child_via_track: no org_id, membership helper or parent-EXISTS predicate',
      ]);
    });

    it('a listed table no migration creates (a typo in labelOsTables())', () => {
      expect(labelOsViolations(realState, ['org_memebers'])).toEqual([
        'org_memebers: no migration creates it (typo in labelOsTables()?)',
        'org_memebers: row level security is not enabled',
      ]);
    });

    it('a new migration calling is_team_member()', () => {
      const state = withFixture(
        fx('team', `CREATE POLICY lo_fixture_team ON public.lo_fixture FOR ALL USING (public.is_team_member());`),
      );
      expect(state.teamMemberCallers).not.toEqual(TEAM_MEMBER_CALLERS_ALLOWED);
      expect(state.teamMemberCallers).toContain('999_fixture_team.sql');
    });

    it('is_team_member() mentioned only in a comment is not a call', () => {
      const state = withFixture(fx('comment', `-- we no longer use is_team_member() here\nSELECT 1;`));
      expect(state.teamMemberCallers).toEqual(TEAM_MEMBER_CALLERS_ALLOWED);
    });
  });
});
