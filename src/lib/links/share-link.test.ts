import { describe, expect, it } from 'vitest';
import {
  emptyLinkFacets,
  filterShareLinks,
  sortShareLinks,
  type LinkFacets,
  fromSharePatchResponse,
  isShareLinkExpired,
  shareLinkEndpoint,
  shareLinkKey,
  shareOpensLabel,
  toSharePatchBody,
  type ShareLinkFacts,
} from './share-link';

function link(over: Partial<ShareLinkFacts> = {}): ShareLinkFacts {
  return {
    id: 'row-1',
    source: 'share_links',
    token: 'tok1',
    title: 'Night Drive',
    content_title: null,
    kind: 'share',
    plays: 0,
    expires_at: null,
    revoked_at: null,
    allow_downloads: true,
    password_protected: false,
    ...over,
  };
}

describe('shareLinkEndpoint', () => {
  it('addresses a track share by token', () => {
    expect(shareLinkEndpoint(link())).toBe('/api/share/tok1');
  });

  it('addresses a project share by row id, not token', () => {
    expect(shareLinkEndpoint(link({ source: 'project_shares' }))).toBe('/api/shares/row-1');
  });
});

describe('shareLinkKey', () => {
  it('namespaces by source so the two id sequences cannot collide', () => {
    const a = shareLinkKey(link({ id: 'x' }));
    const b = shareLinkKey(link({ source: 'project_shares', id: 'x' }));
    expect(a).not.toBe(b);
    expect(a).toBe('share_links:x');
  });
});

describe('isShareLinkExpired', () => {
  const now = new Date('2026-01-10T00:00:00Z');

  it('treats a revoked link as expired even with no expiry date', () => {
    expect(isShareLinkExpired(link({ revoked_at: '2026-01-01T00:00:00Z' }), now)).toBe(true);
  });

  it('is live when there is no expiry at all', () => {
    expect(isShareLinkExpired(link(), now)).toBe(false);
  });

  it('is expired past its date and live before it', () => {
    expect(isShareLinkExpired(link({ expires_at: '2026-01-09T00:00:00Z' }), now)).toBe(true);
    expect(isShareLinkExpired(link({ expires_at: '2026-01-11T00:00:00Z' }), now)).toBe(false);
  });

  it('does not expire a link on an unparseable date', () => {
    expect(isShareLinkExpired(link({ expires_at: 'not-a-date' }), now)).toBe(false);
  });
});

describe('toSharePatchBody', () => {
  it('passes token-share fields through unchanged', () => {
    expect(toSharePatchBody(link(), { title: 'New' })).toEqual({ title: 'New' });
  });

  it('renames title to label for a project share', () => {
    const body = toSharePatchBody(link({ source: 'project_shares' }), { title: 'New' });
    expect(body).toEqual({ label: 'New' });
    expect(body.title).toBeUndefined();
  });

  it('drops undefined keys so a one-field patch blanks nothing else', () => {
    const body = toSharePatchBody(link({ source: 'project_shares' }), { title: 'New' });
    expect('allow_downloads' in body).toBe(false);
  });

  it('carries allow_downloads on both sources', () => {
    expect(toSharePatchBody(link(), { allow_downloads: false })).toEqual({ allow_downloads: false });
    expect(toSharePatchBody(link({ source: 'project_shares' }), { allow_downloads: false }))
      .toEqual({ allow_downloads: false });
  });

  it('keeps an explicit null — clearing an expiry is not the same as omitting it', () => {
    expect(toSharePatchBody(link(), { expires_at: null })).toEqual({ expires_at: null });
  });
});

describe('fromSharePatchResponse', () => {
  it('returns the response as-is for a token share', () => {
    const out = fromSharePatchResponse(link(), { title: 'New', plays: 4 });
    expect(out).toEqual({ title: 'New', plays: 4 });
  });

  it('reads label back into title for a project share', () => {
    const out = fromSharePatchResponse(link({ source: 'project_shares' }), { label: 'New' });
    expect(out.title).toBe('New');
  });

  it('falls back to the content title when the label is cleared', () => {
    const out = fromSharePatchResponse(
      link({ source: 'project_shares', content_title: 'Summer EP' }),
      { label: null },
    );
    expect(out.title).toBe('Summer EP');
  });
});

describe('filterShareLinks', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  const links = [
    link({ token: 'a', title: 'Night Drive' }),
    link({ token: 'b', title: null, revoked_at: '2026-01-01T00:00:00Z' }),
    link({ token: 'c', title: 'Locked', password_protected: true }),
    link({ token: 'd', title: 'No files', allow_downloads: false }),
  ];

  it('All returns everything', () => {
    expect(filterShareLinks(links, { filter: 'All', search: '', now })).toHaveLength(4);
  });

  it('Active excludes revoked links', () => {
    const out = filterShareLinks(links, { filter: 'Active', search: '', now });
    expect(out.map((l) => l.token)).toEqual(['a', 'c', 'd']);
  });

  it('Expired returns only the revoked one', () => {
    const out = filterShareLinks(links, { filter: 'Expired', search: '', now });
    expect(out.map((l) => l.token)).toEqual(['b']);
  });

  it('Protected and Downloads filter on their flags', () => {
    expect(filterShareLinks(links, { filter: 'Protected', search: '', now }).map((l) => l.token))
      .toEqual(['c']);
    expect(filterShareLinks(links, { filter: 'Downloads', search: '', now }).map((l) => l.token))
      .toEqual(['a', 'b', 'c']);
  });

  it('finds an untitled link by its token — the only handle it has', () => {
    const out = filterShareLinks(links, { filter: 'All', search: 'b', now });
    expect(out.map((l) => l.token)).toEqual(['b']);
  });

  it('search is case-insensitive and trimmed', () => {
    const out = filterShareLinks(links, { filter: 'All', search: '  NIGHT ', now });
    expect(out.map((l) => l.token)).toEqual(['a']);
  });

  it('combines a facet with the text query', () => {
    const out = filterShareLinks(links, { filter: 'Active', search: 'locked', now });
    expect(out.map((l) => l.token)).toEqual(['c']);
  });
});

describe('shareOpensLabel', () => {
  it('calls the counter what it counts: page opens', () => {
    expect(shareOpensLabel(0)).toBe('0 opens');
    expect(shareOpensLabel(1)).toBe('1 open');
    expect(shareOpensLabel(1204)).toBe('1,204 opens');
  });

  it('reads a missing or nonsense count as zero', () => {
    expect(shareOpensLabel(null)).toBe('0 opens');
    expect(shareOpensLabel(undefined)).toBe('0 opens');
    expect(shareOpensLabel(-2)).toBe('0 opens');
  });
});

describe('facets', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  const links = [
    link({ token: 'a', kind: 'track', plays: 3, recipient_kind: 'client', content_title: 'Midnight Tape' }),
    link({ token: 'b', kind: 'project', plays: 0, revoked_at: '2026-01-01T00:00:00Z', password_protected: true }),
    link({ token: 'c', kind: 'playlist', plays: null, expires_at: '2026-01-05T00:00:00Z', allow_downloads: false, recipient_kind: 'rapper' }),
    link({ token: 'd', kind: 'share', plays: 1, recipient_kind: 'friend' }),
  ];
  const f = (over: Partial<Record<keyof LinkFacets, string[]>>): LinkFacets => {
    const base = emptyLinkFacets();
    return {
      status: new Set((over.status ?? []) as never),
      kind: new Set((over.kind ?? []) as never),
      recipient: new Set((over.recipient ?? []) as never),
      options: new Set((over.options ?? []) as never),
    } as LinkFacets & typeof base;
  };
  const tokens = (facets: LinkFacets, search = '') =>
    filterShareLinks(links, { search, facets, now }).map((l) => l.token);

  it('status: active / expired / revoked / never opened', () => {
    expect(tokens(f({ status: ['active'] }))).toEqual(['a', 'd']);
    expect(tokens(f({ status: ['expired'] }))).toEqual(['b', 'c']);
    expect(tokens(f({ status: ['revoked'] }))).toEqual(['b']);
    expect(tokens(f({ status: ['unopened'] }))).toEqual(['b', 'c']);
  });
  it('kind, and unknown kinds match no kind facet', () => {
    expect(tokens(f({ kind: ['track'] }))).toEqual(['a']);
    expect(tokens(f({ kind: ['project', 'playlist'] }))).toEqual(['b', 'c']);
  });
  it('recipient only matches rows that carry it', () => {
    expect(tokens(f({ recipient: ['rapper'] }))).toEqual(['c']);
    expect(tokens(f({ recipient: ['client', 'friend'] }))).toEqual(['a', 'd']);
  });
  it('options', () => {
    expect(tokens(f({ options: ['password'] }))).toEqual(['b']);
    expect(tokens(f({ options: ['downloads_off'] }))).toEqual(['c']);
    expect(tokens(f({ options: ['downloads_on'] }))).toEqual(['a', 'b', 'd']);
  });
  it('any within a group, all across groups', () => {
    expect(tokens(f({ options: ['password', 'downloads_off'] }))).toEqual(['b', 'c']);
    expect(tokens(f({ status: ['expired'], options: ['password', 'downloads_off'] }))).toEqual(['b', 'c']);
    expect(tokens(f({ status: ['active'], options: ['password', 'downloads_off'] }))).toEqual([]);
    expect(tokens(f({ status: ['expired'], kind: ['playlist'], recipient: ['rapper'] }))).toEqual(['c']);
  });
  it('search also matches the content title', () => {
    expect(tokens(emptyLinkFacets(), 'midnight')).toEqual(['a']);
  });
});

describe('sortShareLinks', () => {
  const now = new Date('2026-01-10T00:00:00Z');
  const rows = [
    link({ token: 'a', title: 'beta', created_at: '2026-01-02T00:00:00Z', plays: 2, expires_at: '2026-02-01T00:00:00Z' }),
    link({ token: 'b', title: 'Alpha', created_at: '2026-01-03T00:00:00Z', plays: 9 }),
    link({ token: 'c', title: null, content_title: 'gamma', created_at: '2026-01-01T00:00:00Z', plays: 2, expires_at: '2026-01-20T00:00:00Z' }),
    link({ token: 'd', title: 'Delta', created_at: '2026-01-04T00:00:00Z', expires_at: '2026-01-01T00:00:00Z' }),
    link({ token: 'e', title: 'Eps', created_at: '2026-01-05T00:00:00Z', revoked_at: '2026-01-06T00:00:00Z', expires_at: '2026-01-11T00:00:00Z' }),
  ];
  const order = (s: Parameters<typeof sortShareLinks>[1]) => sortShareLinks(rows, s, now).map((l) => l.token);
  it('newest / oldest', () => {
    expect(order('newest')).toEqual(['e', 'd', 'b', 'a', 'c']);
    expect(order('oldest')).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
  it('most opened, ties by newest', () => {
    expect(order('opens')).toEqual(['b', 'a', 'c', 'e', 'd']);
  });
  it('expiring soon: nearest live expiry, then no expiry, then expired/revoked last', () => {
    expect(order('expiring')).toEqual(['c', 'a', 'b', 'e', 'd']);
  });
  it('title A–Z uses content title when untitled', () => {
    expect(order('title')).toEqual(['b', 'a', 'd', 'e', 'c']);
  });
  it('does not mutate its input', () => {
    const copy = rows.map((r) => r.token);
    sortShareLinks(rows, 'oldest', now);
    expect(rows.map((r) => r.token)).toEqual(copy);
  });
});
