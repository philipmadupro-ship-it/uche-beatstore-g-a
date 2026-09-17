import { describe, expect, it } from 'vitest';
import {
  filterShareLinks,
  fromSharePatchResponse,
  isShareLinkExpired,
  shareLinkEndpoint,
  shareLinkKey,
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
