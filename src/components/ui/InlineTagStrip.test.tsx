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

describe('InlineTagStrip overflow', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => `tag${String(i + 1).padStart(2, '0')}`);
  const pillCount = () => screen.queryAllByRole('button', { name: /^Remove tag/ }).length;

  it('shows everything for a few tags, with no toggle', () => {
    renderStrip(many(1));
    expect(pillCount()).toBe(1);
    expect(screen.queryByRole('button', { name: /more|Show less/ })).toBeNull();
  });

  it('collapses 60 tags behind +N more and expands with aria-expanded', () => {
    renderStrip(many(60));
    expect(pillCount()).toBe(10);
    const toggle = screen.getByRole('button', { name: '+50 more' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(pillCount()).toBe(60);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(less);
    expect(pillCount()).toBe(10);
  });

  it('removes a visible pill while collapsed', () => {
    const onToggle = renderStrip(many(60));
    fireEvent.click(screen.getByRole('button', { name: 'Remove tag tag01' }));
    expect(onToggle).toHaveBeenCalledWith({ tag: 'tag01', category: 'custom', active: true });
  });

  it('keeps a newly added custom tag visible while collapsed', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<InlineTagStrip tags={many(60)} groups={groups} onToggle={onToggle} subject="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    fireEvent.change(screen.getByLabelText('Add a custom tag'), { target: { value: 'zzz-new' } });
    fireEvent.submit(screen.getByLabelText('Add a custom tag').closest('form')!);
    expect(onToggle).toHaveBeenCalledWith({ tag: 'zzz-new', category: 'custom', active: false });
    rerender(<InlineTagStrip tags={[...many(60), 'zzz-new']} groups={groups} onToggle={onToggle} subject="project" />);
    expect(screen.getByRole('button', { name: 'Remove tag zzz-new' })).toBeTruthy();
  });

  it('keeps a tag added from the taxonomy visible while collapsed', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<InlineTagStrip tags={many(60)} groups={groups} onToggle={onToggle} subject="project" />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit project tags' }));
    fireEvent.click(screen.getByRole('button', { name: 'Drill' }));
    rerender(<InlineTagStrip tags={[...many(60), 'Drill']} groups={groups} onToggle={onToggle} subject="project" />);
    expect(screen.getByRole('button', { name: 'Remove tag Drill' })).toBeTruthy();
  });
});

describe('InlineTagStrip collapsed set', () => {
  it('shows exactly the first N of the order the strip renders when expanded', () => {
    const names = Array.from({ length: 60 }, (_, i) => `Tag number ${i + 1}`);
    renderStrip(names);
    const order = () => screen.getAllByRole('button', { name: /^Remove tag/ }).map((b) => b.getAttribute('aria-label'));
    const collapsed = order();
    fireEvent.click(screen.getByRole('button', { name: '+50 more' }));
    const expanded = order();
    expect(collapsed).toHaveLength(10);
    expect(collapsed).toEqual(expanded.slice(0, 10));
  });
});
