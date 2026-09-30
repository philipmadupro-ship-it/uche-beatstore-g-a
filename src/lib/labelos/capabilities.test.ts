import { describe, expect, it } from 'vitest';
import {
  ALL_CAPABILITIES,
  EXTERNAL_ACTIONS,
  EXTERNAL_PROJECT_ROLES,
  EXTERNAL_PROJECT_ROLE_TABLE,
  FUNCTION_PRESETS,
  FUNCTIONS_BY_ORG_KIND,
  ORG_FUNCTIONS,
  ORG_KINDS,
  RECORDING_KINDS,
  ROLES,
  ROLES_BY_ORG_KIND,
  audioCapabilityFor,
  can,
  capabilitiesFor,
  externalCan,
  externalCapabilities,
  recordingClass,
  type Capability,
  type ExternalAction,
  type ExternalProjectRole,
  type OrgFunction,
} from './capabilities';

/**
 * The tables below are 06-permission-model.md transcribed cell by cell.
 * If a test here fails, either the module drifted or the doc changed —
 * change the doc first, then this table, then the module.
 */

// §2.4 rows, in the doc's order. Each column lists the capabilities a
// cell grants. "R W" rows expand to .read + .write.
type Column =
  | 'owner'
  | 'admin'
  | 'a_and_r'
  | 'project_manager'
  | 'marketing'
  | 'legal'
  | 'artist_manager'
  | 'producer'
  | 'engineer'
  | 'artist';

const R = true;
const _ = false;

// One row per §2.4 cell group; every column is filled.
const TABLE_2_4: Array<{ row: string; caps: Capability[]; cells: Record<Column, boolean> }> = [
  { row: 'catalog R', caps: ['catalog.read'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: R, legal: R, artist_manager: R, producer: R, engineer: R, artist: R } },
  { row: 'catalog W', caps: ['catalog.write'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: R, producer: R, engineer: R, artist: R } },
  { row: 'audio.finished', caps: ['audio.finished'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: R, legal: R, artist_manager: R, producer: R, engineer: R, artist: R } },
  { row: 'audio.working', caps: ['audio.working'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: R, producer: R, engineer: R, artist: R } },
  { row: 'review.write', caps: ['review.write'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: R, producer: _, engineer: _, artist: _ } },
  // "comment only" for the artist; everyone with review.write can comment too.
  { row: 'review comment', caps: ['review.comment'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: R, producer: _, engineer: _, artist: R } },
  // rights R: A&R "all collaborators", artist "own songs" (scope does the
  // narrowing — role artist is always artist-scoped), producer/engineer
  // "own line" (a narrower capability, below).
  { row: 'rights R', caps: ['rights.read'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: R, artist_manager: R, producer: _, engineer: _, artist: R } },
  { row: 'rights R (own line)', caps: ['rights.read.own_line'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: R, artist_manager: R, producer: R, engineer: R, artist: R } },
  { row: 'rights W', caps: ['rights.write'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: _, legal: R, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'contracts.read', caps: ['contracts.read'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: _, legal: R, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'release.write', caps: ['release.write'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'approve master', caps: ['release.approve.master'], cells: { owner: R, admin: R, a_and_r: R, project_manager: _, marketing: _, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'approve artwork', caps: ['release.approve.artwork'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: R, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'approve legal', caps: ['release.approve.legal'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: _, legal: R, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'approve marketing', caps: ['release.approve.marketing'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: R, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'approve metadata', caps: ['release.approve.metadata'], cells: { owner: R, admin: R, a_and_r: _, project_manager: R, marketing: _, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'share.external', caps: ['share.external'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: _, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  { row: 'members.manage', caps: ['members.manage'], cells: { owner: R, admin: R, a_and_r: _, project_manager: _, marketing: _, legal: _, artist_manager: _, producer: _, engineer: _, artist: _ } },
  // Decided 2026-09-30 (15, "LABEL-02 follow-up"): every function with a
  // column can create tasks, each side its own. The artist role cannot.
  { row: 'tasks.write', caps: ['tasks.write'], cells: { owner: R, admin: R, a_and_r: R, project_manager: R, marketing: R, legal: R, artist_manager: R, producer: R, engineer: R, artist: _ } },
  { row: 'business.read.internal', caps: ['business.read.internal'], cells: { owner: R, admin: R, a_and_r: _, project_manager: R, marketing: R, legal: R, artist_manager: _, producer: _, engineer: _, artist: _ } },
];

/** Capabilities for one §2.4 column, in a label org (every role/function offered). */
function labelColumn(col: Column): ReadonlySet<Capability> {
  if (col === 'owner' || col === 'admin' || col === 'artist') return capabilitiesFor('label', col, []);
  return capabilitiesFor('label', 'member', [col]);
}

const COLUMNS: Column[] = ['owner', 'admin', 'a_and_r', 'project_manager', 'marketing', 'legal', 'artist_manager', 'producer', 'engineer', 'artist'];

describe('capabilitiesFor — §2.4 label org, every cell', () => {
  for (const { row, caps, cells } of TABLE_2_4) {
    for (const col of COLUMNS) {
      it(`${row} × ${col} = ${cells[col] ? '✓' : '—'}`, () => {
        const got = labelColumn(col);
        for (const cap of caps) expect(got.has(cap)).toBe(cells[col]);
      });
    }
  }

  it('each column grants exactly the table, nothing extra (except owner/admin reserved caps)', () => {
    const tabulated = new Set(TABLE_2_4.flatMap((r) => r.caps));
    for (const col of COLUMNS) {
      const expected = new Set(TABLE_2_4.filter((r) => r.cells[col]).flatMap((r) => r.caps));
      const got = labelColumn(col);
      const extras = [...got].filter((c) => !expected.has(c));
      if (col === 'owner' || col === 'admin') {
        // §2.1: owner/admin have "everything" — including the capabilities
        // §2.4 has no row for (org.manage, finance.read).
        expect(extras.every((c) => !tabulated.has(c))).toBe(true);
      } else {
        expect(extras).toEqual([]);
      }
    }
  });

  it('owner and admin hold every capability', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect([...capabilitiesFor('label', role, [])].sort()).toEqual([...ALL_CAPABILITIES].sort());
    }
  });
});

describe('capabilitiesFor — untabulated grants stay closed', () => {
  it('finance and operations grant nothing (deferred, "not for now")', () => {
    expect(capabilitiesFor('label', 'member', ['finance']).size).toBe(0);
    expect(capabilitiesFor('label', 'member', ['operations']).size).toBe(0);
  });

  it('a member with no functions grants nothing', () => {
    expect(capabilitiesFor('label', 'member', []).size).toBe(0);
  });

  it('no function grants org.manage or finance.read', () => {
    for (const fn of ORG_FUNCTIONS) {
      const caps = capabilitiesFor('label', 'member', [fn]);
      expect(caps.has('org.manage')).toBe(false);
      expect(caps.has('finance.read')).toBe(false);
    }
  });

  it('the artist role ignores functions', () => {
    expect(capabilitiesFor('label', 'artist', ['legal', 'a_and_r'])).toEqual(capabilitiesFor('label', 'artist', []));
  });
});

describe('capabilitiesFor — unknown input grants nothing', () => {
  it('unknown org kind', () => {
    expect(capabilitiesFor('management', 'owner', []).size).toBe(0);
    expect(capabilitiesFor('', 'owner', []).size).toBe(0);
  });

  it('unknown role', () => {
    expect(capabilitiesFor('label', 'superuser', ['legal']).size).toBe(0);
    expect(capabilitiesFor('label', 'Owner', []).size).toBe(0);
  });

  it('unknown function contributes nothing, known ones still count', () => {
    expect(capabilitiesFor('label', 'member', ['root']).size).toBe(0);
    expect(capabilitiesFor('label', 'member', ['root', 'marketing'])).toEqual(capabilitiesFor('label', 'member', ['marketing']));
  });

  it('prototype keys are not roles, kinds or functions', () => {
    expect(capabilitiesFor('constructor', 'owner', []).size).toBe(0);
    expect(capabilitiesFor('label', 'toString', []).size).toBe(0);
    expect(capabilitiesFor('label', 'member', ['__proto__', 'hasOwnProperty']).size).toBe(0);
  });

  it('returns a fresh set each call, so a caller cannot widen the table', () => {
    const a = capabilitiesFor('label', 'member', ['marketing']) as Set<Capability>;
    a.add('members.manage');
    expect(capabilitiesFor('label', 'member', ['marketing']).has('members.manage')).toBe(false);
  });
});

describe('capabilitiesFor — §2.4b org kinds', () => {
  it('offers the roles in §2.4b', () => {
    expect(ROLES_BY_ORG_KIND).toEqual({
      artist: ['owner', 'admin', 'member'],
      producer: ['owner', 'admin', 'member'],
      label: ['owner', 'admin', 'member', 'artist'],
    });
  });

  it('offers the functions in §2.4b', () => {
    expect([...FUNCTIONS_BY_ORG_KIND.artist].sort()).toEqual(['artist_manager', 'engineer', 'legal', 'marketing', 'operations', 'producer']);
    expect([...FUNCTIONS_BY_ORG_KIND.producer].sort()).toEqual(['artist_manager', 'engineer', 'operations', 'producer']);
    expect([...FUNCTIONS_BY_ORG_KIND.label].sort()).toEqual([...ORG_FUNCTIONS].sort());
  });

  it('a role the kind does not offer grants nothing', () => {
    expect(capabilitiesFor('artist', 'artist', []).size).toBe(0);
    expect(capabilitiesFor('producer', 'artist', []).size).toBe(0);
  });

  it('a function the kind does not offer grants nothing', () => {
    expect(capabilitiesFor('artist', 'member', ['a_and_r']).size).toBe(0);
    expect(capabilitiesFor('artist', 'member', ['project_manager']).size).toBe(0);
    expect(capabilitiesFor('producer', 'member', ['legal']).size).toBe(0);
    expect(capabilitiesFor('producer', 'member', ['marketing']).size).toBe(0);
    expect(capabilitiesFor('producer', 'member', ['a_and_r', 'producer'])).toEqual(capabilitiesFor('producer', 'member', ['producer']));
  });

  it('an offered function grants the same as in a label org', () => {
    for (const kind of ORG_KINDS) {
      for (const fn of FUNCTIONS_BY_ORG_KIND[kind]) {
        expect(capabilitiesFor(kind, 'member', [fn])).toEqual(capabilitiesFor('label', 'member', [fn]));
      }
    }
  });

  it('owner and admin hold every capability in every kind', () => {
    for (const kind of ORG_KINDS) {
      expect(capabilitiesFor(kind, 'owner', []).size).toBe(ALL_CAPABILITIES.length);
      expect(capabilitiesFor(kind, 'admin', []).size).toBe(ALL_CAPABILITIES.length);
    }
  });
});

describe('capabilitiesFor — ordering', () => {
  const subsets = (a: ReadonlySet<Capability>, b: ReadonlySet<Capability>) => [...a].every((c) => b.has(c));

  it('owner ⊇ admin ⊇ any member or artist, in every kind', () => {
    for (const kind of ORG_KINDS) {
      const owner = capabilitiesFor(kind, 'owner', []);
      const admin = capabilitiesFor(kind, 'admin', []);
      expect(subsets(admin, owner)).toBe(true);
      // every single function, and every function at once
      for (const fn of ORG_FUNCTIONS) expect(subsets(capabilitiesFor(kind, 'member', [fn]), admin)).toBe(true);
      expect(subsets(capabilitiesFor(kind, 'member', [...ORG_FUNCTIONS]), admin)).toBe(true);
      expect(subsets(capabilitiesFor(kind, 'artist', []), admin)).toBe(true);
    }
  });

  it('write implies read', () => {
    for (const kind of ORG_KINDS) {
      for (const role of ROLES) {
        for (const fn of ORG_FUNCTIONS) {
          const caps = capabilitiesFor(kind, role, [fn]);
          if (caps.has('catalog.write')) expect(caps.has('catalog.read')).toBe(true);
          if (caps.has('rights.write')) expect(caps.has('rights.read')).toBe(true);
          if (caps.has('rights.read')) expect(caps.has('rights.read.own_line')).toBe(true);
          if (caps.has('review.write')) expect(caps.has('review.comment')).toBe(true);
        }
      }
    }
  });

  it('functions are additive', () => {
    const both = capabilitiesFor('label', 'member', ['marketing', 'legal']);
    for (const c of capabilitiesFor('label', 'member', ['marketing'])) expect(both.has(c)).toBe(true);
    for (const c of capabilitiesFor('label', 'member', ['legal'])) expect(both.has(c)).toBe(true);
  });
});

describe('D4 — creative side vs business side', () => {
  it('marketing and legal never get audio.working, in any kind', () => {
    for (const kind of ORG_KINDS) {
      for (const fn of ['marketing', 'legal'] as const) {
        expect(capabilitiesFor(kind, 'member', [fn]).has('audio.working')).toBe(false);
        expect(capabilitiesFor(kind, 'member', [fn, 'marketing', 'legal', 'finance']).has('audio.working')).toBe(false);
      }
    }
  });

  it('A&R never gets rights.write, contracts.read or legal approval', () => {
    const ar = capabilitiesFor('label', 'member', ['a_and_r']);
    expect(ar.has('rights.write')).toBe(false);
    expect(ar.has('contracts.read')).toBe(false);
    expect(ar.has('release.approve.legal')).toBe(false);
  });

  it('artists never get business.read.internal or contracts.read (D5)', () => {
    const artist = capabilitiesFor('label', 'artist', []);
    expect(artist.has('business.read.internal')).toBe(false);
    expect(artist.has('contracts.read')).toBe(false);
  });

  it('an artist who OWNS an artist org sees everything in it, business notes included', () => {
    expect(capabilitiesFor('artist', 'owner', []).has('business.read.internal')).toBe(true);
    expect(capabilitiesFor('artist', 'owner', []).has('contracts.read')).toBe(true);
  });
});

describe('per-member overrides — presets + tweaks (decided 2026-09-30)', () => {
  const marketing = (overrides?: { grant?: string[]; revoke?: string[] }) =>
    capabilitiesFor('label', 'member', ['marketing'], overrides);

  it('no overrides = the preset, unchanged', () => {
    expect(marketing()).toEqual(capabilitiesFor('label', 'member', ['marketing']));
    expect(marketing({})).toEqual(marketing());
    expect(marketing({ grant: [], revoke: [] })).toEqual(marketing());
  });

  it('grant adds a single ability on top of the preset', () => {
    const caps = marketing({ grant: ['audio.working'] });
    expect(caps.has('audio.working')).toBe(true);
    for (const c of marketing()) expect(caps.has(c)).toBe(true);
    expect(caps.size).toBe(marketing().size + 1);
  });

  it('grant brings its implied reads with it', () => {
    const caps = marketing({ grant: ['rights.write'] });
    expect(caps.has('rights.read')).toBe(true);
    expect(caps.has('rights.read.own_line')).toBe(true);
  });

  it('revoke removes a single ability from the preset', () => {
    const caps = marketing({ revoke: ['release.approve.artwork'] });
    expect(caps.has('release.approve.artwork')).toBe(false);
    expect(caps.size).toBe(marketing().size - 1);
  });

  it('revoke wins over grant', () => {
    expect(marketing({ grant: ['audio.working'], revoke: ['audio.working'] }).has('audio.working')).toBe(false);
  });

  it('revoking a read also removes every write that needs it', () => {
    // catalog.read is the floor: without it nothing catalogue-scoped is left.
    for (const fn of ORG_FUNCTIONS) {
      expect(capabilitiesFor('label', 'member', [fn], { revoke: ['catalog.read'] }).size).toBe(0);
    }
    expect(capabilitiesFor('label', 'artist', [], { revoke: ['catalog.read'] }).size).toBe(0);
    const legal = capabilitiesFor('label', 'member', ['legal'], { revoke: ['rights.read.own_line'] });
    expect(legal.has('rights.read')).toBe(false);
    expect(legal.has('rights.write')).toBe(false);
    const pm = capabilitiesFor('label', 'member', ['project_manager'], { revoke: ['review.comment'] });
    expect(pm.has('review.write')).toBe(false);
  });

  it('a member with no function can be built entirely from grants', () => {
    const caps = capabilitiesFor('label', 'member', ['finance'], { grant: ['finance.read', 'catalog.read'] });
    expect([...caps].sort()).toEqual(['catalog.read', 'finance.read']);
  });

  it('unknown or prototype names in overrides are ignored', () => {
    expect(marketing({ grant: ['org.delete', 'toString', '__proto__', ''] })).toEqual(marketing());
    expect(marketing({ revoke: ['nope', 'constructor'] })).toEqual(marketing());
  });

  it('tolerates malformed override lists', () => {
    const bad = { grant: null, revoke: 'audio.finished' } as unknown as { grant: string[]; revoke: string[] };
    expect(marketing(bad)).toEqual(marketing());
  });

  it('owner and admin are not tweakable — they always hold everything', () => {
    for (const kind of ORG_KINDS) {
      for (const role of ['owner', 'admin'] as const) {
        expect(capabilitiesFor(kind, role, [], { revoke: [...ALL_CAPABILITIES] }).size).toBe(ALL_CAPABILITIES.length);
      }
    }
  });

  it('running the org is never grantable by tweak — that is the admin role', () => {
    for (const role of ['member', 'artist'] as const) {
      const caps = capabilitiesFor('label', role, [], { grant: [...ALL_CAPABILITIES] });
      expect(caps.has('members.manage')).toBe(false);
      expect(caps.has('org.manage')).toBe(false);
    }
  });

  it('a granted ability brings catalog.read with it', () => {
    expect([...capabilitiesFor('label', 'member', [], { grant: ['share.external'] })].sort()).toEqual(['catalog.read', 'share.external']);
  });

  it('owner ⊇ admin ⊇ any tweaked member', () => {
    const admin = capabilitiesFor('label', 'admin', []);
    const everything = capabilitiesFor('label', 'member', [], { grant: [...ALL_CAPABILITIES] });
    for (const c of everything) expect(admin.has(c)).toBe(true);
  });

  it('the artist role can be tweaked, but never into business notes or contracts (D5)', () => {
    const artist = capabilitiesFor('label', 'artist', [], {
      grant: ['release.write', 'business.read.internal', 'contracts.read'],
    });
    expect(artist.has('release.write')).toBe(true);
    expect(artist.has('business.read.internal')).toBe(false);
    expect(artist.has('contracts.read')).toBe(false);
    expect(capabilitiesFor('label', 'artist', [], { revoke: ['audio.working'] }).has('audio.working')).toBe(false);
  });

  it('overrides never rescue an unknown kind, an unknown role or a role the kind lacks', () => {
    const grant = { grant: ['catalog.read'] };
    expect(capabilitiesFor('mgmt', 'member', [], grant).size).toBe(0);
    expect(capabilitiesFor('label', 'root', [], grant).size).toBe(0);
    expect(capabilitiesFor('artist', 'artist', [], grant).size).toBe(0);
  });

  it('works the same in every org kind', () => {
    for (const kind of ORG_KINDS) {
      expect(capabilitiesFor(kind, 'member', ['producer'], { grant: ['share.external'] }).has('share.external')).toBe(true);
    }
  });

  it('can() applies a member\'s overrides', () => {
    const m = { orgKind: 'label', role: 'member', functions: ['marketing'], overrides: { grant: ['audio.working'], revoke: ['audio.finished'] } };
    expect(can(m, 'audio.working')).toBe(true);
    expect(can(m, 'audio.finished')).toBe(false);
  });

  it('exposes the presets, so a UI can show what a function starts with', () => {
    for (const fn of ORG_FUNCTIONS) {
      const caps = capabilitiesFor('label', 'member', [fn]);
      for (const c of FUNCTION_PRESETS[fn]) expect(caps.has(c)).toBe(true);
    }
    expect(FUNCTION_PRESETS.finance).toEqual([]);
  });
});

describe('can', () => {
  it('asks the same table as capabilitiesFor', () => {
    const m = { orgKind: 'label', role: 'member', functions: ['legal'] } as const;
    expect(can(m, 'contracts.read')).toBe(true);
    expect(can(m, 'audio.working')).toBe(false);
  });

  it('unknown capability, kind, role or function is false', () => {
    expect(can({ orgKind: 'label', role: 'owner', functions: [] }, 'org.delete' as Capability)).toBe(false);
    expect(can({ orgKind: 'mgmt', role: 'owner', functions: [] }, 'catalog.read')).toBe(false);
    expect(can({ orgKind: 'label', role: 'root', functions: [] }, 'catalog.read')).toBe(false);
    expect(can({ orgKind: 'label', role: 'member', functions: ['root'] }, 'catalog.read')).toBe(false);
  });

  it('tolerates a missing or malformed functions list', () => {
    const member = { orgKind: 'label', role: 'member', functions: null as unknown as string[] };
    expect(can(member, 'catalog.read')).toBe(false);
    expect(can({ orgKind: 'label', role: 'owner', functions: undefined as unknown as string[] }, 'catalog.read')).toBe(true);
  });

  it('answers for an external project member from the §2.6 capability view', () => {
    expect(can({ externalRole: 'editor' }, 'catalog.read')).toBe(true);
    expect(can({ externalRole: 'editor' }, 'rights.write')).toBe(false);
    expect(can({ externalRole: 'viewer' }, 'review.comment')).toBe(false);
    expect(can({ externalRole: 'commenter' }, 'review.comment')).toBe(true);
    expect(can({ externalRole: 'owner' }, 'catalog.read')).toBe(false);
  });
});

describe('recordingClass / audioCapabilityFor — §2.3', () => {
  const FINISHED = ['master', 'clean', 'instrumental', 'acapella'];
  const WORKING = ['beat_source', 'demo', 'rough', 'topline', 'loop'];

  it('classifies every song_recordings kind', () => {
    for (const k of FINISHED) expect(recordingClass(k)).toBe('finished');
    for (const k of WORKING) expect(recordingClass(k)).toBe('working');
    // 05 lists `reference`; §2.3 does not classify it — working is the closed side.
    expect(recordingClass('reference')).toBe('working');
    expect([...RECORDING_KINDS].sort()).toEqual([...FINISHED, ...WORKING, 'mix', 'reference'].sort());
  });

  it('a mix is finished only when it is the current mix of a selected / released song', () => {
    expect(recordingClass('mix')).toBe('working');
    expect(recordingClass('mix', { currentMixOfSelectedSong: false })).toBe('working');
    expect(recordingClass('mix', { currentMixOfSelectedSong: true })).toBe('finished');
    // the flag means nothing for other kinds
    expect(recordingClass('demo', { currentMixOfSelectedSong: true })).toBe('working');
  });

  it('unknown kinds classify as nothing, and so need a capability no one has', () => {
    expect(recordingClass('stem')).toBeNull();
    expect(recordingClass('')).toBeNull();
    expect(recordingClass('toString')).toBeNull();
    expect(audioCapabilityFor('stem')).toBeNull();
  });

  it('maps class to the audio capability', () => {
    expect(audioCapabilityFor('master')).toBe('audio.finished');
    expect(audioCapabilityFor('topline')).toBe('audio.working');
    expect(audioCapabilityFor('mix', { currentMixOfSelectedSong: true })).toBe('audio.finished');
  });

  it('marketing hears a master but not a topline', () => {
    const mkt = { orgKind: 'label', role: 'member', functions: ['marketing'] } as const;
    expect(can(mkt, audioCapabilityFor('master')!)).toBe(true);
    expect(can(mkt, audioCapabilityFor('topline')!)).toBe(false);
    expect(can(mkt, audioCapabilityFor('mix')!)).toBe(false);
  });
});

describe('external project roles — §2.6, every cell', () => {
  // true = ✓, false = —, 'per_project' = follows the project's allow_downloads.
  const TABLE_2_6: Record<ExternalProjectRole, Record<ExternalAction, boolean | 'per_project'>> = {
    viewer: { listen: true, comment: false, upload_versions: false, edit_metadata: false, propose_own_credit: false, download_masters: 'per_project' },
    commenter: { listen: true, comment: true, upload_versions: false, edit_metadata: false, propose_own_credit: false, download_masters: 'per_project' },
    contributor: { listen: true, comment: true, upload_versions: true, edit_metadata: false, propose_own_credit: true, download_masters: true },
    editor: { listen: true, comment: true, upload_versions: true, edit_metadata: true, propose_own_credit: true, download_masters: true },
  };

  it('the exported table is §2.6', () => {
    expect(EXTERNAL_PROJECT_ROLE_TABLE).toEqual(TABLE_2_6);
  });

  for (const role of EXTERNAL_PROJECT_ROLES) {
    for (const action of EXTERNAL_ACTIONS) {
      const cell = TABLE_2_6[role][action];
      it(`${role} × ${action} = ${String(cell)}`, () => {
        if (cell === 'per_project') {
          expect(externalCan(role, action, { allowDownloads: true })).toBe(true);
          expect(externalCan(role, action, { allowDownloads: false })).toBe(false);
        } else {
          expect(externalCan(role, action, { allowDownloads: true })).toBe(cell);
          expect(externalCan(role, action, { allowDownloads: false })).toBe(cell);
        }
      });
    }
  }

  it('allowDownloads defaults to off', () => {
    expect(externalCan('viewer', 'download_masters')).toBe(false);
  });

  it('unknown role or action grants nothing', () => {
    expect(externalCan('admin', 'listen', { allowDownloads: true })).toBe(false);
    expect(externalCan('editor', 'delete', { allowDownloads: true })).toBe(false);
    expect(externalCan('constructor', 'listen')).toBe(false);
    expect(externalCapabilities('owner').size).toBe(0);
  });

  it('never includes rights.write, contracts.read, release.* or members.manage', () => {
    for (const role of EXTERNAL_PROJECT_ROLES) {
      const caps = externalCapabilities(role);
      expect(caps.has('rights.write')).toBe(false);
      expect(caps.has('contracts.read')).toBe(false);
      expect(caps.has('members.manage')).toBe(false);
      expect([...caps].some((c) => c.startsWith('release.'))).toBe(false);
      // D2: their own split line only, never the whole sheet
      expect(caps.has('rights.read')).toBe(false);
      expect(caps.has('rights.read.own_line')).toBe(true);
    }
  });

  it('the external capability view grows with the role, never past the §2.6 columns', () => {
    expect([...externalCapabilities('viewer')].sort()).toEqual(['catalog.read', 'rights.read.own_line']);
    expect([...externalCapabilities('commenter')].sort()).toEqual(['catalog.read', 'review.comment', 'rights.read.own_line']);
    expect(externalCapabilities('contributor')).toEqual(externalCapabilities('commenter'));
    expect(externalCapabilities('editor')).toEqual(externalCapabilities('commenter'));
  });
});

describe('vocabulary', () => {
  it('lists the §2.2 functions and §2.1 roles', () => {
    expect([...ORG_FUNCTIONS].sort()).toEqual(
      ['a_and_r', 'project_manager', 'marketing', 'legal', 'finance', 'artist_manager', 'producer', 'engineer', 'operations'].sort() as OrgFunction[],
    );
    expect([...ROLES].sort()).toEqual(['admin', 'artist', 'member', 'owner']);
    expect([...ORG_KINDS].sort()).toEqual(['artist', 'label', 'producer']);
  });

  it('lists the §2.3 capabilities plus the two narrowings', () => {
    expect([...ALL_CAPABILITIES].sort()).toEqual(
      [
        'catalog.read', 'catalog.write', 'audio.finished', 'audio.working', 'review.write', 'review.comment',
        'rights.read', 'rights.read.own_line', 'rights.write', 'contracts.read', 'release.write',
        'release.approve.master', 'release.approve.artwork', 'release.approve.legal', 'release.approve.marketing',
        'release.approve.metadata', 'tasks.write', 'share.external', 'members.manage', 'org.manage',
        'finance.read', 'business.read.internal',
      ].sort(),
    );
  });
});
