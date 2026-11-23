import { describe, expect, it } from 'vitest';
import { decodeLinkView, encodeLinkView, hasLinkViewParams } from './link-filters-url';
import { emptyLinkFacets } from './share-link';

describe('link view URL', () => {
  it('writes nothing for the default view', () => {
    expect(encodeLinkView({ facets: emptyLinkFacets(), sort: 'newest', search: '' })).toBe('');
    expect(hasLinkViewParams('')).toBe(false);
  });

  it('round-trips every facet, sort and search', () => {
    const state = {
      facets: {
        status: new Set(['expired', 'unopened']),
        kind: new Set(['playlist']),
        recipient: new Set(['rapper', 'client']),
        options: new Set(['password', 'downloads_off']),
      },
      sort: 'expiring',
      search: 'night & day',
    } as never;
    const qs = encodeLinkView(state);
    expect(hasLinkViewParams(`?${qs}`)).toBe(true);
    const back = decodeLinkView(`?${qs}`);
    expect([...back.facets.status]).toEqual(['expired', 'unopened']);
    expect([...back.facets.kind]).toEqual(['playlist']);
    expect([...back.facets.recipient]).toEqual(['client', 'rapper']);
    expect([...back.facets.options]).toEqual(['password', 'downloads_off']);
    expect(back.sort).toBe('expiring');
    expect(back.search).toBe('night & day');
  });

  it('drops unknown values and falls back to the default sort', () => {
    const back = decodeLinkView('?status=active&status=bogus&kind=song&to=cat&opt=nope&sort=random');
    expect([...back.facets.status]).toEqual(['active']);
    expect(back.facets.kind.size).toBe(0);
    expect(back.facets.recipient.size).toBe(0);
    expect(back.facets.options.size).toBe(0);
    expect(back.sort).toBe('newest');
  });
});
