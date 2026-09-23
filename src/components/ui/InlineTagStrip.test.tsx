// @vitest-environment jsdom

/**
 * The failure this guards is silent: the tag APIs take `{ tag, category }` on
 * DELETE as well as POST, but the strip only ever has the tag NAME. Send the
 * wrong category and the request succeeds while the tag stays put.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { InlineTagStrip } from './InlineTagStrip';
import type { TagGroup } from '@/lib/ui/tag-groups';

afterEach(cleanup);

const groups: TagGroup[] = [
  { category: 'project_type', label: 'Project type', options: ['Album', 'EP'] },
  { category: 'genre', label: 'Genre', options: ['Trap', 'Drill'] },
];

function renderStrip(tags: string[], onToggle = vi.fn()) {
  render(<InlineTagStrip tags={tags} groups={groups} onToggle={onToggle} subject="project" />);
  return onToggle;
}

describe('InlineTagStrip', () => {
  it('removes a pill with the category it was stored under', () => {
    const onToggle = renderStrip(['Trap']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag Trap' }));
    expect(onToggle).toHaveBeenCalledWith({ tag: 'Trap', category: 'genre', active: true });
  });

  it('falls back to custom for a tag outside the taxonomy', () => {
    const onToggle = renderStrip(['summer-2026']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag summer-2026' }));
    expect(onToggle).toHaveBeenCalledWith({ tag: 'summer-2026', category: 'custom', active: true });
  });

  it('orders pills by group, not by whatever order the API returned', () => {
    renderStrip(['Trap', 'Album']);
    const pills = screen.getAllByRole('button', { name: /^Remove tag/ }).map((b) => b.getAttribute('aria-label'));
    expect(pills).toEqual(['Remove tag Album', 'Remove tag Trap']);
  });

  it('adds a taxonomy tag from the popover as inactive→active', () => {
    const onToggle = renderStrip([]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drill' }));
    expect(onToggle).toHaveBeenCalledWith({ tag: 'Drill', category: 'genre', active: false });
  });

  it('marks an applied taxonomy option as pressed in the popover', () => {
    renderStrip(['Drill']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    expect(screen.getByRole('button', { name: 'Drill' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('refuses a duplicate custom tag regardless of case', () => {
    const onToggle = renderStrip(['Trap']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    const input = screen.getByLabelText('Add a custom tag');
    fireEvent.change(input, { target: { value: 'trap' } });
    fireEvent.submit(input.closest('form')!);
    // Only the pill's own remove would have fired; the add is refused.
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('adds a genuinely new custom tag', () => {
    const onToggle = renderStrip(['Trap']);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    const input = screen.getByLabelText('Add a custom tag');
    fireEvent.change(input, { target: { value: ' late-night ' } });
    fireEvent.submit(input.closest('form')!);
    expect(onToggle).toHaveBeenCalledWith({ tag: 'late-night', category: 'custom', active: false });
  });
});
