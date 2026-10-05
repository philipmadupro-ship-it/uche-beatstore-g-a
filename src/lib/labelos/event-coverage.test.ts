import { describe, expect, it } from 'vitest';
import { coverageGaps, mutatingHandlers, staleAllowances, stripComments } from './event-coverage';

const fixture = (body: string) => [{ path: 'fixture/route.ts', source: body }];

describe('mutatingHandlers', () => {
  it('finds POST/PATCH/PUT/DELETE as functions or consts, and ignores GET and HEAD', () => {
    const src = `
export async function GET() { return 1; }
export async function POST() { recordEvent(a); }
export const PATCH = async () => { auditRpc(admin, 'x', {}); };
export async function PUT() {}
export async function DELETE() {}
export async function HEAD() {}
`;
    expect(mutatingHandlers(src).map((h) => h.method)).toEqual(['POST', 'PATCH', 'PUT', 'DELETE']);
  });

  it('scopes a handler to its own body', () => {
    const [post, del] = mutatingHandlers(`
export async function POST() { await recordEvent(admin); }
export async function DELETE() { await remove(); }
`);
    expect(post.body).toContain('recordEvent');
    expect(del.body).not.toContain('recordEvent');
  });

  it('strips comments but keeps URLs', () => {
    expect(stripComments("// recordEvent(x)\nconst u = 'https://a.test'; /* recordEvent( */ x")).toBe("\nconst u = 'https://a.test';  x");
  });
});

describe('coverageGaps — the guard itself', () => {
  it('FAILS a fixture handler with no event', () => {
    const gaps = coverageGaps(fixture(`export async function POST() { await db.insert({}); return ok(); }`));
    expect(gaps).toEqual(['fixture/route.ts:POST']);
  });

  it('fails the one handler without an event even when a sibling records one', () => {
    const gaps = coverageGaps(
      fixture(`
export async function POST() { await recordEvent(a, b, 'song.created', {}); }
export async function DELETE() { await db.delete(); }
`),
    );
    expect(gaps).toEqual(['fixture/route.ts:DELETE']);
  });

  it('is not fooled by a comment, or by a helper that is never called from the handler', () => {
    expect(coverageGaps(fixture(`// recordEvent(\nexport async function POST() { /* auditRpc( */ }`))).toEqual(['fixture/route.ts:POST']);
    expect(
      coverageGaps(fixture(`async function helper() { await recordEvent(); }\nexport async function POST() { await db.insert(); }`)),
    ).toEqual(['fixture/route.ts:POST']);
  });

  it('accepts recordEvent, an audit RPC, or the accept function', () => {
    for (const call of ["await recordEvent(a, b, 'x.y', {})", "await auditRpc(admin, 'memberRemove', {})", 'admin.rpc(ACCEPT_INVITATION_RPC, {})']) {
      expect(coverageGaps(fixture(`export async function POST() { ${call}; }`))).toEqual([]);
    }
  });

  it('honours a reasoned allowance, and reports it stale once it no longer applies', () => {
    const allow = { 'fixture/route.ts:POST': 'plumbing' };
    const bare = fixture(`export async function POST() { return ok(); }`);
    expect(coverageGaps(bare, allow)).toEqual([]);
    expect(staleAllowances(bare, allow)).toEqual([]);
    expect(staleAllowances(fixture(`export async function POST() { await recordEvent(a); }`), allow)).toEqual(['fixture/route.ts:POST']);
    expect(staleAllowances(fixture(`export async function GET() {}`), allow)).toEqual(['fixture/route.ts:POST']);
  });
});
