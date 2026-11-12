// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FilterBar, DEFAULT_FILTERS, type LibraryFilters } from './FilterBar';
import { buildTagFacetOptions } from '@/lib/library/tag-filter';

afterEach(cleanup);

const fresh = (): LibraryFilters => ({
  ...DEFAULT_FILTERS, types: new Set(), genres: new Set(), tags: new Set(),
  statuses: new Set(), triage: new Set(), keys: new Set(),
});

describe('FilterBar — Tags facet', () => {
  it('lets you filter by "Ready to send", which is a status tag and not a genre', () => {
    const onChange = vi.fn();
    const tagOptions = buildTagFacetOptions([
      { track_tags: [{ tag: 'ready to send', category: 'custom' }] },
      { track_tags: [{ tag: 'Ready to send', category: 'status' }, { tag: 'chicago' }] },
    ]);
    render(<FilterBar filters={fresh()} onChange={onChange} tagOptions={tagOptions} />);

    fireEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    // Counts fold the two spellings together.
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Ready to send · 2' }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect([...onChange.mock.calls[0][0].tags]).toEqual(['Ready to send']);
  });

  it('offers the producer’s own tags and shows the selection as a removable chip', () => {
    const onChange = vi.fn();
    const tagOptions = buildTagFacetOptions([{ track_tags: [{ tag: 'chicago' }] }]);
    const filters = { ...fresh(), tags: new Set(['chicago']) };
    render(<FilterBar filters={filters} onChange={onChange} tagOptions={tagOptions} />);

    fireEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'chicago · 1' }).getAttribute('aria-checked')).toBe('true');

    // The active-filter chip is there even with the menu closed.
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getAllByRole('button').find((b) => b.closest('span')?.textContent === 'chicago')!);
    expect(onChange.mock.calls.at(-1)?.[0].tags.size).toBe(0);
  });

  it('still lists the taxonomy without counts when no options are passed', () => {
    render(<FilterBar filters={fresh()} onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /^Tags/ }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Ready to send' })).toBeTruthy();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark' })).toBeTruthy();
  });
});
