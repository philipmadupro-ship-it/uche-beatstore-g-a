// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { LinkActivity } from './LinkActivity';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const activity = (over: Record<string, unknown> = {}) => ({
  sends: 2, opens: 5, people: 3, plays: 12, downloads: 4, lastActivityAt: new Date(Date.now() - 2 * 3600_000).toISOString(), since: null, contacts: [], ...over,
});
const stub = (body: unknown, ok = true) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, json: async () => body })));

describe('LinkActivity', () => {
  it('shows the strip with the opens hint', async () => {
    stub({ schemaReady: true, activity: { 'share_links:L1': activity() } });
    render(<LinkActivity linkId="L1" source="share_links" />);
    await waitFor(() => expect(screen.getByTestId('link-activity')).toBeTruthy());
    const text = screen.getByTestId('link-activity').textContent ?? '';
    expect(text).toContain('Sent 2 · Opened 5 (3 people) · Played 12 · Downloaded 4 · last 2h ago');
    expect(text).toContain('Opens count page loads.');
    expect(text).not.toContain('since');
  });

  it('says since when the link predates the log', async () => {
    stub({ schemaReady: true, activity: { 'share_links:L1': activity({ since: '2026-11-23T10:00:00.000Z', people: 1 }) } });
    render(<LinkActivity linkId="L1" source="share_links" />);
    await waitFor(() => expect(screen.getByTestId('link-activity')).toBeTruthy());
    expect(screen.getByTestId('link-activity').textContent).toContain('(1 person)');
    expect(screen.getByTestId('link-activity').textContent).toContain('counted since Nov 23');
  });

  it('renders nothing when the log is not set up or the request fails', async () => {
    stub({ schemaReady: false, activity: {} });
    const { container, unmount } = render(<LinkActivity linkId="L1" source="project_shares" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container.textContent).toBe('');
    unmount();
    stub(null, false);
    const again = render(<LinkActivity linkId="L1" source="project_shares" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(again.container.textContent).toBe('');
  });
});
