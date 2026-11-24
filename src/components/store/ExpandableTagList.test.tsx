// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ExpandableTagList } from './ExpandableTagList';

afterEach(cleanup);
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ tag: `tag ${i + 1}`, category: 'custom' }));

describe('ExpandableTagList', () => {
  it('shows 1 tag with no toggle', () => {
    render(<ExpandableTagList tags={many(1)} />);
    expect(screen.getByText('tag 1')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('shows 9 tags in full (limit + 1)', () => {
    render(<ExpandableTagList tags={many(9)} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('collapses 60 and toggles with aria-expanded', () => {
    render(<ExpandableTagList tags={many(60)} />);
    const list = screen.getByTestId('store-tag-list');
    expect(list.querySelectorAll('span').length).toBe(8);
    const btn = screen.getByRole('button', { name: '+52 more' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe(list.id);
    fireEvent.click(btn);
    expect(list.querySelectorAll('span').length).toBe(60);
    expect(screen.getByRole('button', { name: 'Show less' }).getAttribute('aria-expanded')).toBe('true');
  });
});
