// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { computeAttention } from '@/lib/labelos/attention';
import { canonicalInput } from '@/lib/labelos/attention-fixture';
import { NeedsAttention } from './NeedsAttention';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
afterEach(cleanup);

describe('NeedsAttention', () => {
  it('renders the canonical three, each with a person and a next action link', () => {
    const { items } = computeAttention(canonicalInput());
    render(<NeedsAttention items={items} restricted={0} />);
    expect(screen.getByTestId('needs-attention-count').textContent).toBe('3');
    for (const item of items) {
      expect(screen.getByTestId(`attention-${item.id}`).textContent).toContain(item.title);
      expect(screen.getByTestId(`attention-detail-${item.id}`).textContent).toBe(item.detail);
      expect(screen.getByTestId(`attention-person-${item.id}`).textContent).toBe(item.person.name);
      expect(screen.getByTestId(`attention-action-${item.id}`).textContent).toBe(item.action.verb);
      const link = screen.getByRole('link', { name: `${item.action.verb}: ${item.title}` });
      expect(link.getAttribute('href')).toBe(item.action.href);
    }
    expect(screen.getByTestId('attention-detail-' + items[0].id).textContent).toBe('Blocked: Legal (Dana), Artwork (Maya) · target in 23 days');
  });

  it('says so when nothing needs attention', () => {
    render(<NeedsAttention items={[]} restricted={0} />);
    expect(screen.getByTestId('needs-attention-count').textContent).toBe('0');
    expect(screen.getByTestId('needs-attention-empty').textContent).toBe('Nothing needs attention.');
    expect(screen.queryByTestId('needs-attention-restricted')).toBeNull();
  });

  it('shows restricted songs as a number, never a title', () => {
    const { items, restricted } = computeAttention(canonicalInput({ songs: canonicalInput().songs.map((s) => ({ ...s, readable: false })) }));
    const { container } = render(<NeedsAttention items={items} restricted={restricted} />);
    expect(restricted).toBe(1);
    expect(within(container).getByTestId('needs-attention-restricted').textContent).toBe('1 song restricted');
    expect(container.textContent).not.toContain('Track 04');
  });

  it('explains missing release gates instead of looking clean', () => {
    render(<NeedsAttention items={[]} restricted={0} releasesReady={false} />);
    expect(screen.getByTestId('needs-attention-releases-unavailable')).toBeTruthy();
  });
});
