/**
 * GET /api/org/[orgId]/audio/[trackId] (LABEL-13), run through the REAL
 * lib/auth/org-access, lib/labelos/org-audio and lib/audio/stream-source
 * against an in-memory database. Only the R2 client is faked: it serves
 * bytes per key and honours `Range: bytes=a-b`.
 *
 * The matrix is role × scope × recording kind × variant, from `06` §2.4 /
 * §2.5 and 17 R1. Expected statuses come from the tables in the docs
 * (EXPECT below), not from the implementation.
 *
 *   L (label): projects P1 (inbox of artist C1) and P2 (C2 via
 *   project_contacts); one track per recording kind in P1, a master in P2,
 *   a beat in no project, an unclassifiable remix.
 *   L2 (label): one track. Producer catalogue: one track (org_id NULL).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { memoryAdmin, type MemoryDb } from '@/lib/labelos/mocks/memory-db';

const L = '10000000-0000-4000-8000-000000000001';
const L2 = '10000000-0000-4000-8000-000000000002';

const u = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const OWN = u(1);
const ADM = u(2);
const AR = u(3);
const PM = u(4);
const AMGR = u(5);
const PRODF = u(6);
const ENG = u(7);
const MK = u(8);
const LEG = u(9);
const FIN = u(10);
const ART = u(11);
const AR_SC = u(12);
const MK_SC = u(13);
const X = u(14);
const STRANGER = u(15);
const PRODUCER = u(16);

const C1 = '30000000-0000-4000-8000-0000000000c1';
const C2 = '30000000-0000-4000-8000-0000000000c2';
const P1 = '40000000-0000-4000-8000-0000000000a1';
const P2 = '40000000-0000-4000-8000-0000000000a2';

const k = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = {
  song: k(1), // song, in review → its own mix, working
  selected: k(2), // song, selected → its own mix, finished
  master: k(3), // master link from `song` → finished
  instrumental: k(4), // instrumental link from `song` → finished
  topline: k(5), // topline link → working
  loop: k(6), // loop link → working
  demo: k(7), // demo link → working
  version: k(8), // version link → mix (not current), working
  beat: k(9), // song_beats → beat_source, working
  standaloneLoop: k(10), // loop, unlinked, in P1 → loop, working (LABEL-13 R1 extension)
  remix: k(11), // remix, unlinked → no kind: fail closed
  c2Master: k(12), // master of song2, in P2 (artist C2)
  song2: k(13), // song in P2
  noProject: k(14), // beat in no project → whole-org only
  otherOrg: k(15), // in L2
  producer: k(16), // org_id NULL
} as const;

type TrackKey = keyof typeof T;
type Cls = 'finished' | 'working' | 'none';
const CLASS: Record<Exclude<TrackKey, 'otherOrg' | 'producer'>, Cls> = {
  song: 'working',
  selected: 'finished',
  master: 'finished',
  instrumental: 'finished',
  topline: 'working',
  loop: 'working',
  demo: 'working',
  version: 'working',
  beat: 'working',
  standaloneLoop: 'working',
  remix: 'none',
  c2Master: 'finished',
  song2: 'working',
  noProject: 'working',
};
/** The artist each track's project belongs to; null = in no project. */
const ARTIST_OF: Record<keyof typeof CLASS, string | null> = {
  song: C1, selected: C1, master: C1, instrumental: C1, topline: C1, loop: C1, demo: C1, version: C1, beat: C1,
  standaloneLoop: C1, remix: C1, c2Master: C2, song2: C2, noProject: null,
};

/** 06 §2.4 audio columns per member (label org); scope per §2.5. */
type Who = { id: string; finished: boolean; working: boolean; catalog: boolean; scope: string[] | null };
const MEMBERS: Record<string, Who> = {
  owner: { id: OWN, finished: true, working: true, catalog: true, scope: null },
  admin: { id: ADM, finished: true, working: true, catalog: true, scope: null },
  a_and_r: { id: AR, finished: true, working: true, catalog: true, scope: null },
  project_manager: { id: PM, finished: true, working: true, catalog: true, scope: null },
  artist_manager: { id: AMGR, finished: true, working: true, catalog: true, scope: null },
  producer: { id: PRODF, finished: true, working: true, catalog: true, scope: null },
  engineer: { id: ENG, finished: true, working: true, catalog: true, scope: null },
  marketing: { id: MK, finished: true, working: false, catalog: true, scope: null },
  legal: { id: LEG, finished: true, working: false, catalog: true, scope: null },
  finance: { id: FIN, finished: false, working: false, catalog: false, scope: null },
  'artist (role, own: C1)': { id: ART, finished: true, working: true, catalog: true, scope: [C1] },
  'a_and_r scoped to C1': { id: AR_SC, finished: true, working: true, catalog: true, scope: [C1] },
  'marketing scoped to C1': { id: MK_SC, finished: true, working: false, catalog: true, scope: [C1] },
};

const VARIANTS = ['preview', 'full', 'wav', 'stem:vocals'] as const;
type Variant = (typeof VARIANTS)[number];

function EXPECT(who: Who, track: keyof typeof CLASS, variant: Variant): number {
  const artist = ARTIST_OF[track];
  if (who.scope !== null && (artist === null || !who.scope.includes(artist))) return 404;
  if (!who.catalog) return 403;
  const cls = CLASS[track];
  if (cls === 'none') return 403;
  const needFinished = cls === 'finished';
  const needWorking = cls === 'working' || variant === 'stem:vocals';
  if (needFinished && !who.finished) return 403;
  if (needWorking && !who.working) return 403;
  return 200;
}

// ── fakes ──────────────────────────────────────────────────────────────

let current: string | null = null;
let db: MemoryDb;
let mem: ReturnType<typeof memoryAdmin>;
const r2Gets: { key: string; range: string | null }[] = [];

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: current ? { id: current } : null } }) } }),
}));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => mem.client }));
vi.mock('@/lib/log', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
vi.mock('@/lib/storage/upload', () => {
  const parse = (value: string) => {
    if (!value.startsWith('r2://')) return null;
    const rest = value.slice(5);
    const slash = rest.indexOf('/');
    return slash > 0 ? { bucket: rest.slice(0, slash), key: rest.slice(slash + 1) } : null;
  };
  return {
    parseR2ObjectRef: parse,
    getStoredObject: async (source: string, range?: string | null) => {
      const ref = parse(source);
      if (!ref) return null;
      r2Gets.push({ key: ref.key, range: range ?? null });
      const full = new TextEncoder().encode(`BYTES:${ref.key}`.padEnd(100, '.'));
      const m = range ? /^bytes=(\d+)-(\d*)$/.exec(range) : null;
      const start = m ? Number(m[1]) : 0;
      const end = m && m[2] ? Math.min(Number(m[2]), full.length - 1) : full.length - 1;
      const body = full.slice(start, end + 1);
      return {
        Body: { transformToWebStream: () => new Blob([body]).stream() },
        ContentType: ref.key.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
        AcceptRanges: 'bytes',
        ContentLength: body.length,
        ContentRange: m ? `bytes ${start}-${end}/${full.length}` : undefined,
      };
    },
  };
});

function member(user: string, role: string, functions: string[] = [], scope = 'org', org = L) {
  return { org_id: org, user_id: user, role, functions, scope, cap_grants: [], cap_revokes: [] };
}

function track(key: TrackKey, type: string, org: string | null, extra: Record<string, unknown> = {}) {
  const id = T[key];
  return {
    id, org_id: org, user_id: org ? OWN : PRODUCER, title: key, type, song_stage: null,
    audio_url: `r2://priv/${key}.mp3`, wav_url: `r2://priv/${key}.wav`, preview_url: `r2://priv/${key}.preview.mp3`,
    ...extra,
  };
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJtest';
  process.env.R2_PRIVATE_BUCKET_NAME = 'priv';
  process.env.R2_BUCKET_NAME = 'pub';
  current = null;
  r2Gets.length = 0;
  const link = (from: TrackKey, to: TrackKey, relation: string) => ({ from_track_id: T[from], to_track_id: T[to], relation, position: 0 });
  const inProject = (project: string, keys: TrackKey[]) => keys.map((key, position) => ({ project_id: project, track_id: T[key], position }));
  db = {
    tables: {
      organizations: [
        { id: L, kind: 'label', deleted_at: null },
        { id: L2, kind: 'label', deleted_at: null },
      ],
      org_members: [
        member(OWN, 'owner'),
        member(ADM, 'admin'),
        member(AR, 'member', ['a_and_r']),
        member(PM, 'member', ['project_manager']),
        member(AMGR, 'member', ['artist_manager']),
        member(PRODF, 'member', ['producer']),
        member(ENG, 'member', ['engineer']),
        member(MK, 'member', ['marketing']),
        member(LEG, 'member', ['legal']),
        member(FIN, 'member', ['finance']),
        member(ART, 'artist', [], 'artists'),
        member(AR_SC, 'member', ['a_and_r'], 'artists'),
        member(MK_SC, 'member', ['marketing'], 'artists'),
        member(X, 'owner', [], 'org', L2),
        member(OWN, 'owner', [], 'org', L2),
      ],
      member_artist_scopes: [
        { org_id: L, user_id: ART, contact_id: C1 },
        { org_id: L, user_id: AR_SC, contact_id: C1 },
        { org_id: L, user_id: MK_SC, contact_id: C1 },
      ],
      contacts: [
        { id: C1, org_id: L, user_id: null, name: 'Nova', category: 'artist' },
        { id: C2, org_id: L, user_id: null, name: 'Kilo', category: 'artist' },
      ],
      projects: [
        { id: P1, org_id: L, user_id: OWN, name: 'Inbox — Nova', inbox_for_contact_id: C1 },
        { id: P2, org_id: L, user_id: OWN, name: 'Kilo LP', inbox_for_contact_id: null },
      ],
      project_contacts: [{ project_id: P2, contact_id: C2 }],
      project_tracks: [
        ...inProject(P1, ['song', 'selected', 'master', 'instrumental', 'topline', 'loop', 'demo', 'version', 'beat', 'standaloneLoop', 'remix']),
        ...inProject(P2, ['c2Master', 'song2']),
      ],
      tracks: [
        track('song', 'song', L, { song_stage: 'in_review' }),
        track('selected', 'song', L, { song_stage: 'selected' }),
        track('master', 'song', L),
        track('instrumental', 'instrumental', L),
        track('topline', 'topline', L),
        track('loop', 'loop', L),
        track('demo', 'song', L),
        track('version', 'song', L),
        track('beat', 'beat', L),
        track('standaloneLoop', 'loop', L),
        track('remix', 'remix', L),
        track('c2Master', 'song', L),
        track('song2', 'song', L, { song_stage: 'in_review' }),
        track('noProject', 'beat', L),
        track('otherOrg', 'song', L2),
        track('producer', 'beat', null),
      ],
      song_beats: [{ song_track_id: T.song, beat_track_id: T.beat, position: 0 }],
      track_links: [
        link('song', 'master', 'master'),
        link('song', 'instrumental', 'instrumental'),
        link('song', 'topline', 'topline'),
        link('song', 'loop', 'loop'),
        link('song', 'demo', 'demo'),
        link('song', 'version', 'version'),
        link('song2', 'c2Master', 'master'),
      ],
      stems: Object.values(T).map((id) => ({
        track_id: id, status: 'done', vocals_url: `r2://priv/stems/${id}/vocals.wav`, drums_url: null, bass_url: null, other_url: null,
      })),
    },
  };
  mem = memoryAdmin(db);
});

async function get(as: string | null, org: string, trackId: string, query = '', headers: Record<string, string> = {}) {
  current = as;
  const req = new NextRequest(`https://app.test/api/org/${org}/audio/${trackId}${query}`, { headers });
  const mod = await import('./route');
  return mod.GET(req, { params: Promise.resolve({ orgId: org, trackId }) });
}

// ── the matrix ─────────────────────────────────────────────────────────

const CASES: [string, keyof typeof CLASS, Variant, number][] = [];
for (const [name, who] of Object.entries(MEMBERS)) {
  for (const key of Object.keys(CLASS) as (keyof typeof CLASS)[]) {
    for (const v of VARIANTS) CASES.push([name, key, v, EXPECT(who, key, v)]);
  }
}

describe('role × scope × recording kind × variant (06 §2.4–2.5, 17 R1, D4)', () => {
  it(`covers ${Object.keys(MEMBERS).length} members × ${Object.keys(CLASS).length} tracks × ${VARIANTS.length} variants`, () => {
    expect(CASES.length).toBe(Object.keys(MEMBERS).length * Object.keys(CLASS).length * VARIANTS.length);
    // The matrix holds every outcome, not only 200s.
    expect(new Set(CASES.map((c) => c[3]))).toEqual(new Set([200, 403, 404]));
  });

  it.each(CASES)('%s · %s · %s → %i', async (name, key, variant, status) => {
    const res = await get(MEMBERS[name].id, L, T[key], `?variant=${encodeURIComponent(variant)}`);
    expect(res.status).toBe(status);
    if (status === 200) {
      const body = await res.text();
      const file = variant === 'stem:vocals' ? `stems/${T[key]}/vocals.wav` : `${key}.${variant === 'wav' ? 'wav' : variant === 'preview' ? 'preview.mp3' : 'mp3'}`;
      expect(body.startsWith(`BYTES:${file}`)).toBe(true);
      expect(res.headers.get('location')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    } else {
      expect(r2Gets).toEqual([]);
    }
  });
});

describe('D4 headline cases', () => {
  it('marketing: 403 on a topline or a loop, 200 on a master', async () => {
    expect((await get(MK, L, T.topline)).status).toBe(403);
    expect((await get(MK, L, T.loop)).status).toBe(403);
    expect((await get(MK, L, T.master)).status).toBe(200);
  });

  it("a song's current mix becomes finished when the song is selected", async () => {
    expect((await get(MK, L, T.song)).status).toBe(403);
    db.tables.tracks.find((t) => t.id === T.song)!.song_stage = 'selected';
    expect((await get(MK, L, T.song)).status).toBe(200);
  });

  it('a revoked audio.working holds even for an owner-preset function', async () => {
    db.tables.org_members.find((m) => m.user_id === AR && m.org_id === L)!.cap_revokes = ['audio.working'];
    expect((await get(AR, L, T.topline)).status).toBe(403);
    expect((await get(AR, L, T.master)).status).toBe(200);
  });

  it('a master another song also uses as a version needs both capabilities', async () => {
    db.tables.track_links.push({ from_track_id: T.song2, to_track_id: T.master, relation: 'version', position: 0 });
    expect((await get(MK, L, T.master)).status).toBe(403);
    expect((await get(AR, L, T.master)).status).toBe(200);
  });
});

describe('who reaches the route at all', () => {
  it('401 without a session', async () => {
    expect((await get(null, L, T.master)).status).toBe(401);
  });

  it('404 for a non-member, a member of another org, and the producer — never 403', async () => {
    for (const who of [STRANGER, X, PRODUCER]) expect((await get(who, L, T.master)).status).toBe(404);
  });

  it('a producer-era track (org_id IS NULL) is 404, even to an org owner', async () => {
    expect((await get(OWN, L, T.producer)).status).toBe(404);
  });

  it("another org's track is 404 under this org's path, even to a member of both", async () => {
    expect((await get(OWN, L, T.otherOrg)).status).toBe(404);
    expect((await get(OWN, L2, T.otherOrg)).status).toBe(200);
  });

  it('a missing or malformed id is 404', async () => {
    expect((await get(OWN, L, k(99))).status).toBe(404);
    expect((await get(OWN, L, 'not-a-uuid')).status).toBe(404);
  });
});

describe('the client names a track and a variant, never a file', () => {
  it('400 for an unknown variant', async () => {
    for (const v of ['mp3', 'stem:lead', 'r2://priv/master.wav']) {
      expect((await get(OWN, L, T.master, `?variant=${encodeURIComponent(v)}`)).status).toBe(400);
    }
  });

  it('400 for src / key parameters — there is no way to pass a URL', async () => {
    expect((await get(OWN, L, T.master, '?src=r2%3A%2F%2Fpriv%2Fproducer.wav')).status).toBe(400);
    expect((await get(OWN, L, T.master, '?key=producer.wav')).status).toBe(400);
    expect(r2Gets).toEqual([]);
  });

  it('the auth check runs before the query is read: a stranger with a bad variant is still 404', async () => {
    expect((await get(STRANGER, L, T.master, '?variant=nope')).status).toBe(404);
  });

  it('404 when the track has no file for that variant', async () => {
    db.tables.tracks.find((t) => t.id === T.master)!.wav_url = null;
    expect((await get(OWN, L, T.master, '?variant=wav')).status).toBe(404);
    db.tables.stems = [];
    expect((await get(OWN, L, T.master, '?variant=stem:vocals')).status).toBe(404);
  });

  it('download=1 sends an attachment named from the title, never the storage key', async () => {
    const res = await get(OWN, L, T.master, '?variant=wav&download=1');
    expect(res.status).toBe(200);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toContain('attachment; filename="master.wav"');
    expect(cd).not.toContain('r2://');
  });
});

describe('Range', () => {
  it('forwards Range to storage and answers 206 with Content-Range and only those bytes', async () => {
    const res = await get(OWN, L, T.master, '?variant=full', { range: 'bytes=0-9' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-9/100');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-length')).toBe('10');
    expect(await res.text()).toBe('BYTES:mast');
    expect(r2Gets).toEqual([{ key: 'master.mp3', range: 'bytes=0-9' }]);
  });

  it('a mid-file range for a seek', async () => {
    const res = await get(MK, L, T.master, '?variant=wav', { range: 'bytes=6-' });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 6-99/100');
    expect((await res.text()).startsWith('master.wav')).toBe(true);
  });

  it('no Range → 200 with the whole object', async () => {
    const res = await get(OWN, L, T.master);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect((await res.text()).length).toBe(100);
  });

  it('a refused caller never reaches storage, Range or not', async () => {
    expect((await get(MK, L, T.loop, '', { range: 'bytes=0-9' })).status).toBe(403);
    expect(r2Gets).toEqual([]);
  });
});
