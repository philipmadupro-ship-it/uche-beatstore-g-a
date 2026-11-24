// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LinkFilterBar } from './LinkFilterBar';
import { emptyLinkFacets, type LinkFacets, type LinkSort } from '@/lib/links/share-link';

afterEach(cleanup);

function Harness({ mobile = false, hasRecipients = true }: { mobile?: boolean; hasRecipients?: boolean }) {
  const [facets, setFacets] = useState<LinkFacets>(emptyLinkFacets);
  const [sort, setSort] = useState<LinkSort>('newest');
  const [search, setSearch] = useState('');
  const shown = facets.kind.size || search ? 2 : 9;
  return (
    <LinkFilterBar facets={facets} onFacets={setFacets} sort={sort} onSort={setSort}
      search={search} onSearch={setSearch} shown={shown} total={9} hasRecipients={hasRecipients} mobile={mobile} />
  );
}

describe('LinkFilterBar', () => {
  it('shows N of M while filtering, and Clear all resets facets and search', () => {
    render(<Harness />);
    expect(screen.getByTestId('link-count').textContent).toBe('9 links');
    expect(screen.queryByRole('button', { name: /clear all/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Playlist' }));
    fireEvent.change(screen.getByLabelText('Search links'), { target: { value: 'night' } });
    expect(screen.getByTestId('link-count').textContent).toBe('2 of 9');
    expect(screen.getByRole('button', { name: 'Playlist' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /clear all/i }));
    expect(screen.getByTestId('link-count').textContent).toBe('9 links');
    expect((screen.getByLabelText('Search links') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Playlist' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('hides the Recipient group when no row carries a recipient', () => {
    render(<Harness hasRecipients={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    expect(screen.queryByRole('group', { name: 'Recipient' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Status' })).toBeTruthy();
  });
});
