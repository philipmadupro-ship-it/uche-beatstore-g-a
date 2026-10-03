import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { capabilitiesFor, type Capability } from './capabilities';
import {
  ALWAYS_RESTRICTED_KINDS,
  ORG_ASSET_KINDS,
  VISUAL_ASSET_KINDS,
  LEGAL_ASSET_KINDS,
  assetReadClass,
  assignableOrgAssetKinds,
  isDownloadStart,
  orgAssetPermissions,
  canReadOrgAsset,
  canWriteOrgAsset,
  guessOrgAssetKind,
  isOrgAssetKind,
  orgAssetObjectKey,
  orgProjectAssetKeyOf,
  requiredAssetCapabilities,
  resolveSensitivity,
  toOrgAssetView,
} from './org-assets';
import { PROJECT_ASSET_KINDS, validateAssetFile } from '@/lib/projects/assets';

const ORG = '10000000-0000-4000-8000-0000000000aa';
const ORG2 = '10000000-0000-4000-8000-0000000000bb';
const PROJECT = '40000000-0000-4000-8000-0000000000a1';
const OTHER_PROJECT = '40000000-0000-4000-8000-0000000000a2';

const label = (role: 'owner' | 'admin' | 'member' | 'artist', functions: string[] = []) => capabilitiesFor('label', role, functions);
const MARKETING = label('member', ['marketing']);
const AR = label('member', ['a_and_r']);
const LEGAL = label('member', ['legal']);
const OWNER = label('owner');
const ARTIST = label('artist');
const FINANCE = label('member', ['finance']);

const asset = (kind: string, sensitivity: 'normal' | 'restricted' = 'normal') => ({ kind, sensitivity });

describe('kinds', () => {
  it('org kinds are the producer kinds plus photo, video, contract, split_sheet, session', () => {
    expect(ORG_ASSET_KINDS).toEqual([...PROJECT_ASSET_KINDS, 'photo', 'video', 'contract', 'split_sheet', 'session']);
    expect(isOrgAssetKind('split_sheet')).toBe(true);
    expect(isOrgAssetKind('script')).toBe(false);
  });

  it('every kind has exactly one read class; anything unknown is working (needs the most)', () => {
    for (const k of ORG_ASSET_KINDS) expect(['visual', 'legal', 'working']).toContain(assetReadClass(k));
    expect(assetReadClass('artwork')).toBe('visual');
    expect(assetReadClass('photo')).toBe('visual');
    expect(assetReadClass('video')).toBe('visual');
    expect(assetReadClass('lyrics')).toBe('visual');
    expect(assetReadClass('contract')).toBe('legal');
    expect(assetReadClass('split_sheet')).toBe('legal');
    for (const k of ['reference', 'audio', 'document', 'other', 'session', 'nonsense']) expect(assetReadClass(k)).toBe('working');
  });

  it('contracts and split sheets are always restricted; other kinds take what was asked, default normal', () => {
    expect(ALWAYS_RESTRICTED_KINDS).toEqual(['contract', 'split_sheet']);
    expect(resolveSensitivity('contract')).toBe('restricted');
    expect(resolveSensitivity('split_sheet', 'normal')).toBe('restricted');
    expect(resolveSensitivity('artwork')).toBe('normal');
    expect(resolveSensitivity('document', 'restricted')).toBe('restricted');
  });

  it('guesses contracts, split sheets, sessions, video and photos from the name', () => {
    expect(guessOrgAssetKind('Nova - recording agreement.pdf')).toBe('contract');
    expect(guessOrgAssetKind('Contract_v2.docx')).toBe('contract');
    expect(guessOrgAssetKind('Midnight split sheet.pdf')).toBe('split_sheet');
    expect(guessOrgAssetKind('splits.xlsx')).toBe('split_sheet');
    expect(guessOrgAssetKind('Midnight.als')).toBe('session');
    expect(guessOrgAssetKind('Midnight session.zip')).toBe('session');
    expect(guessOrgAssetKind('teaser.mp4')).toBe('video');
    expect(guessOrgAssetKind('press photo 1.jpg')).toBe('photo');
    expect(guessOrgAssetKind('cover.png')).toBe('artwork');
    expect(guessOrgAssetKind('Midnight lyrics.txt')).toBe('lyrics');
    expect(guessOrgAssetKind('notes.pdf')).toBe('document');
  });

  it('only a document is read as a contract or split sheet by its name', () => {
    expect(guessOrgAssetKind('Split Second - cover.png')).toBe('artwork');
    expect(guessOrgAssetKind('split vocals.wav')).toBe('audio');
    expect(guessOrgAssetKind('contract signing (BTS).mp4')).toBe('video');
    expect(guessOrgAssetKind('Split Second session.als')).toBe('session');
  });
});

describe('the org allowlist', () => {
  it('accepts sessions, video, spreadsheets and TIFF only for an org', () => {
    for (const name of ['a.als', 'a.flp', 'a.ptx', 'a.rpp', 'a.cpr', 'a.webm', 'a.m4v', 'a.csv', 'a.xlsx', 'a.tif']) {
      expect(validateAssetFile({ name, size: 10 }, { org: true }).ok, name).toBe(true);
      expect(validateAssetFile({ name, size: 10 }), name).toEqual({ ok: false, error: 'unsupported-type' });
    }
  });

  it('still refuses scripts for an org', () => {
    for (const name of ['a.html', 'a.htm', 'a.svg', 'a.js', 'a.exe', 'noext']) {
      expect(validateAssetFile({ name, size: 10 }, { org: true })).toEqual({ ok: false, error: 'unsupported-type' });
    }
  });
});

describe('who reads what (06 §2.4, D4)', () => {
  it('needs catalog.read, plus audio.working for working material, plus contracts.read when restricted', () => {
    expect(requiredAssetCapabilities(asset('artwork'))).toEqual(['catalog.read']);
    expect(requiredAssetCapabilities(asset('contract', 'restricted'))).toEqual(['catalog.read', 'contracts.read']);
    expect(requiredAssetCapabilities(asset('session'))).toEqual(['catalog.read', 'audio.working']);
    expect(requiredAssetCapabilities(asset('document', 'restricted'))).toEqual(['catalog.read', 'audio.working', 'contracts.read']);
  });

  it('marketing: artwork, photos, video and lyrics; no working material, no contracts', () => {
    for (const k of VISUAL_ASSET_KINDS) expect(canReadOrgAsset(MARKETING, asset(k)), k).toBe(true);
    for (const k of ['session', 'reference', 'audio', 'document', 'other']) expect(canReadOrgAsset(MARKETING, asset(k)), k).toBe(false);
    expect(canReadOrgAsset(MARKETING, asset('contract', 'restricted'))).toBe(false);
  });

  it('A&R: all the music and working material; no legal', () => {
    for (const k of ['artwork', 'session', 'reference', 'audio', 'document']) expect(canReadOrgAsset(AR, asset(k)), k).toBe(true);
    for (const k of LEGAL_ASSET_KINDS) expect(canReadOrgAsset(AR, asset(k, 'restricted')), k).toBe(false);
    expect(canReadOrgAsset(AR, asset('artwork', 'restricted'))).toBe(false);
  });

  it('legal: contracts and split sheets, restricted visuals; not working material', () => {
    for (const k of LEGAL_ASSET_KINDS) expect(canReadOrgAsset(LEGAL, asset(k, 'restricted')), k).toBe(true);
    expect(canReadOrgAsset(LEGAL, asset('photo', 'restricted'))).toBe(true);
    expect(canReadOrgAsset(LEGAL, asset('session'))).toBe(false);
  });

  it('a roster artist never opens a restricted file, even by tweak', () => {
    expect(canReadOrgAsset(ARTIST, asset('artwork'))).toBe(true);
    expect(canReadOrgAsset(ARTIST, asset('session'))).toBe(true);
    expect(canReadOrgAsset(ARTIST, asset('contract', 'restricted'))).toBe(false);
    const tweaked = capabilitiesFor('label', 'artist', [], { grant: ['contracts.read'] });
    expect(canReadOrgAsset(tweaked, asset('contract', 'restricted'))).toBe(false);
  });

  it('owner reads everything; a member with no catalogue reads nothing', () => {
    for (const k of ORG_ASSET_KINDS) {
      expect(canReadOrgAsset(OWNER, asset(k, resolveSensitivity(k))), k).toBe(true);
      expect(canReadOrgAsset(new Set<Capability>(), asset(k)), k).toBe(false);
    }
    expect(canReadOrgAsset(FINANCE, asset('artwork'))).toBe(false);
  });
});

describe('who writes what', () => {
  it('catalog.write for a normal file the member can read', () => {
    expect(canWriteOrgAsset(AR, asset('session'))).toBe(true);
    expect(canWriteOrgAsset(MARKETING, asset('photo'))).toBe(false); // catalog R only
    expect(canWriteOrgAsset(ARTIST, asset('artwork'))).toBe(true);
  });

  it('a restricted file needs contracts.read and catalog.write or rights.write: legal and owners, not A&R', () => {
    expect(canWriteOrgAsset(LEGAL, asset('contract', 'restricted'))).toBe(true);
    expect(canWriteOrgAsset(OWNER, asset('split_sheet', 'restricted'))).toBe(true);
    expect(canWriteOrgAsset(AR, asset('contract', 'restricted'))).toBe(false);
    expect(canWriteOrgAsset(LEGAL, asset('photo'))).toBe(false); // normal needs catalog.write
  });
});

describe('storage keys', () => {
  it('an org file lives under orgs/<org>/assets/<project>/', () => {
    expect(orgAssetObjectKey(ORG.toUpperCase(), PROJECT, 'abcDEF_123-x', 'pdf')).toBe(`orgs/${ORG}/assets/${PROJECT}/abcDEF_123-x.pdf`);
    expect(() => orgAssetObjectKey('nope', PROJECT, 'abcdefgh', 'pdf')).toThrow();
    expect(() => orgAssetObjectKey(ORG, PROJECT, '../x', 'pdf')).toThrow();
    expect(() => orgAssetObjectKey(ORG, PROJECT, 'abcdefgh', 'p.df')).toThrow();
  });

  it('a stored reference is accepted only in exactly that shape, bucket and project', () => {
    const key = orgAssetObjectKey(ORG, PROJECT, 'abcdefgh12', 'pdf');
    expect(orgProjectAssetKeyOf(`r2://priv/${key}`, ORG, PROJECT, ['priv'])).toBe(key);
    expect(orgProjectAssetKeyOf(`local://${key}`, ORG, PROJECT, ['priv'])).toBe(key);
    expect(orgProjectAssetKeyOf(`r2://public/${key}`, ORG, PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`r2://priv/${key}`, ORG2, PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`r2://priv/${key}`, ORG, OTHER_PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`r2://priv/project-assets/${PROJECT}/abcdefgh12.pdf`, ORG, PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`r2://priv/orgs/${ORG}/tracks/abcdefgh12.wav`, ORG, PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`r2://priv/${key}/../x.pdf`, ORG, PROJECT, ['priv'])).toBeNull();
    expect(orgProjectAssetKeyOf(`https://cdn/${key}`, ORG, PROJECT, ['priv'])).toBeNull();
  });
});

describe('the view', () => {
  it('never carries the stored reference or the uploader, and downloads through the org route', () => {
    const view = toOrgAssetView({
      id: 'a1', project_id: PROJECT, org_id: ORG, kind: 'contract', sensitivity: 'restricted', label: 'Deal', file_name: 'deal.pdf',
      url: 'r2://priv/orgs/x', mime: 'application/pdf', size_bytes: '42', position: 0, in_portal: false, portal_at: null,
      created_at: '2026-10-01', created_by: 'u1',
    });
    expect(view).toEqual({
      id: 'a1', project_id: PROJECT, kind: 'contract', sensitivity: 'restricted', label: 'Deal', file_name: 'deal.pdf',
      mime: 'application/pdf', size_bytes: 42, position: 0, in_portal: false, portal_at: null, created_at: '2026-10-01',
      downloadUrl: `/api/org/${ORG}/projects/${PROJECT}/assets/a1/download`,
    });
    expect(JSON.stringify(view)).not.toMatch(/r2:\/\/|u1/);
  });
});

describe('SQL twin (migration 143)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/143_labelos_org_assets.sql'), 'utf8').replace(/--[^\n]*/g, '');
  const list = (name: string) => {
    const m = new RegExp(`${name}\\s+text\\[\\]\\s*:=\\s*ARRAY\\[([^\\]]*)\\]`).exec(sql);
    return m ? [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]) : null;
  };

  it('labelos_org_asset_allowed uses the same kind classes', () => {
    expect(list('v_visual')).toEqual([...VISUAL_ASSET_KINDS]);
    expect(list('v_legal')).toEqual([...LEGAL_ASSET_KINDS]);
  });

  it('the kind CHECK lists exactly the org kinds, and the always-restricted CHECK the same two kinds', () => {
    const kinds = /project_assets_kind_check\s+CHECK \(kind IN \(([^)]*)\)\)/.exec(sql);
    expect(kinds && [...kinds[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...ORG_ASSET_KINDS]);
    const restricted = /project_assets_restricted_kinds\s+CHECK \(kind NOT IN \(([^)]*)\)/.exec(sql);
    expect(restricted && [...restricted[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...ALWAYS_RESTRICTED_KINDS]);
  });
});

describe('what the Files section may offer', () => {
  it('normal and restricted writes are separate; working kinds need audio.working', () => {
    expect(orgAssetPermissions(AR)).toEqual({ write: true, restricted: false, working: true });
    expect(orgAssetPermissions(LEGAL)).toEqual({ write: false, restricted: true, working: false });
    expect(orgAssetPermissions(MARKETING)).toEqual({ write: false, restricted: false, working: false });
    expect(orgAssetPermissions(OWNER)).toEqual({ write: true, restricted: true, working: true });
  });

  it('assignable kinds: A&R gets no legal kinds, legal no working kinds', () => {
    expect(assignableOrgAssetKinds(orgAssetPermissions(AR))).not.toContain('contract');
    expect(assignableOrgAssetKinds(orgAssetPermissions(AR))).toContain('session');
    expect(assignableOrgAssetKinds(orgAssetPermissions(LEGAL))).toEqual(['artwork', 'lyrics', 'photo', 'video', 'contract', 'split_sheet']);
    expect(assignableOrgAssetKinds(orgAssetPermissions(OWNER))).toEqual([...ORG_ASSET_KINDS]);
  });

  it('a download starts with no Range or a Range from byte 0', () => {
    expect(isDownloadStart(null)).toBe(true);
    expect(isDownloadStart('bytes=0-')).toBe(true);
    expect(isDownloadStart('bytes=0-1023')).toBe(true);
    expect(isDownloadStart('bytes=65536-')).toBe(false);
  });
});
