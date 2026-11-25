// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildActionDigest } from '@/lib/dashboard/action-digest';
import { buildHomeAttention, type AttentionSources } from '@/lib/dashboard/home-attention';
import { HomeNeedsYouView } from './HomeNeedsYou';

afterEach(cleanup);
const ok: AttentionSources = { sales: 'ok', offers: 'ok', leads: 'ok' };
const lead = (i: number) => ({ id: `l${i}`, name: `Lead ${i}`, email: null, created_at: `2026-11-0${i}T00:00:00Z` });

function view(leads: ReturnType<typeof lead>[], sources: AttentionSources = ok, props = {}) {
  const digest = buildActionDigest({ sales: [], offers: [], leads });
  return render(<HomeNeedsYouView attention={buildHomeAttention({ digest, sources })} allItems={digest.items} expandable {...props} />);
}

describe('HomeNeedsYouView', () => {
  it('shows a skeleton, not "nothing waiting", while loading', () => {
    view([], { ...ok, sales: 'loading' });
    expect(screen.getByTestId('needs-you').dataset.status).toBe('loading');
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
  });
  it('says clear only when everything loaded', () => {
    view([]);
    expect(screen.getByText(/nothing waiting/i)).toBeTruthy();
  });
  it('says it could not load, never clear, on error', () => {
    view([], { ...ok, offers: 'error' });
    expect(screen.queryByText(/nothing waiting/i)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/couldn’t load offers/i);
  });
  it('is silent when clear for a brand-new workspace', () => {
    view([], ok, { quietWhenClear: true });
    expect(screen.queryByTestId('needs-you')).toBeNull();
  });
  it('rows are links; overflow expands behind a button', () => {
    view([1, 2, 3, 4, 5, 6].map(lead));
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.getAllByRole('link')[0].getAttribute('href')).toMatch(/^\/contacts\//);
    fireEvent.click(screen.getByRole('button', { name: /2 more/i }));
    expect(screen.getAllByRole('link')).toHaveLength(6);
  });
  it('notes a failed source next to real items', () => {
    view([lead(1)], { ...ok, sales: 'error' });
    expect(screen.getByRole('status').textContent).toMatch(/couldn’t load sales/i);
  });
});
