// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrgShellProvider } from '@/components/labelos/OrgShellContext';
import { OrgCommandPalette } from '@/components/labelos/OrgCommandPalette';
import { useCommandPalette } from '@/hooks/useCommandPalette';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => '/o/night-shift' }));

const SHELL = {
  org: { id: 'org-1', name: 'Night Shift', slug: 'night-shift', kind: 'label' as const },
  role: 'member' as const,
  scope: 'org' as const,
  capabilities: ['catalog.read' as const],
  viewerIsProducer: false,
};

let fetchMock: ReturnType<typeof vi.fn>;
function answer(body: unknown, status = 200) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal('fetch', fetchMock);
}

const hit = (group: string, id: string, title: string, extra: Record<string, unknown> = {}) => ({ group, id, title, sub: null, ...extra });

function mount() {
  render(<OrgShellProvider value={SHELL}><OrgCommandPalette /></OrgShellProvider>);
  act(() => useCommandPalette.getState().setOpen(true));
  return screen.getByRole('combobox');
}

beforeEach(() => {
  push.mockReset();
  answer({ schemaReady: true, jump: null, groups: [] });
});
afterEach(() => {
  act(() => useCommandPalette.getState().setOpen(false));
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrgCommandPalette', () => {
  it('renders nothing while closed and outside an org shell', () => {
    const { container } = render(<OrgCommandPalette />);
    act(() => useCommandPalette.getState().setOpen(true));
    expect(container.innerHTML).toBe('');
  });

  it('lists the org destinations before anything is typed, and requests nothing', () => {
    mount();
    expect(screen.getByText('Go to Artists')).toBeTruthy();
    expect(screen.getByText('Go to Releases')).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches this org by id, groups the hits under their entity, and opens one with Enter', async () => {
    answer({
      schemaReady: true,
      jump: null,
      groups: [
        { group: 'artists', hits: [hit('artists', 'c1', 'Nova')] },
        { group: 'songs', hits: [hit('songs', 's1', 'Runnin Home', { sub: 'Inbox' })] },
        { group: 'people', hits: [hit('people', 'p1', 'Runnin Writer', { sub: 'person' })] },
      ],
    });
    const input = mount();
    fireEvent.change(input, { target: { value: 'runnin' } });
    await waitFor(() => expect(screen.getByText('Runnin Home')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith('/api/org/org-1/search?q=runnin', expect.objectContaining({ cache: 'no-store' }));
    expect(screen.getByText('Artists')).toBeTruthy();
    expect(screen.getByText('Songs')).toBeTruthy();
    expect(screen.getByText('People')).toBeTruthy();
    // no totals anywhere
    expect(document.body.textContent).not.toMatch(/\b\d+\s+(results|more|hidden)/i);

    fireEvent.keyDown(input, { key: 'Enter' }); // the first navigable row: the artist
    expect(push).toHaveBeenCalledWith('/o/night-shift/artists/c1');
  });

  it('arrow keys skip rows with no page, and the song opens its org page', async () => {
    answer({
      schemaReady: true,
      jump: null,
      groups: [
        { group: 'songs', hits: [hit('songs', 's1', 'Runnin Home')] },
        { group: 'people', hits: [hit('people', 'p1', 'Runnin Writer')] },
        { group: 'projects', hits: [hit('projects', 'pr1', 'Runnin EP')] },
      ],
    });
    const input = mount();
    fireEvent.change(input, { target: { value: 'runnin' } });
    await waitFor(() => expect(screen.getByText('Runnin EP')).toBeTruthy());
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // song → (skips the party) → project
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/o/night-shift/projects/pr1');
    expect(screen.queryByText('Runnin Writer')).toBeNull(); // palette closed after the jump
  });

  it('an identifier query shows the jump first and opens it on Enter', async () => {
    answer({ schemaReady: true, jump: hit('songs', 's9', 'Runnin Home', { sub: 'Inbox' }), groups: [] });
    const input = mount();
    fireEvent.change(input, { target: { value: 'GB-AYE-06-01498' } });
    await waitFor(() => expect(screen.getByText('Jump to')).toBeTruthy());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/o/night-shift/songs/s9');
  });

  it('a file opens its project', async () => {
    answer({ schemaReady: true, jump: null, groups: [{ group: 'files', hits: [hit('files', 'f1', 'Runnin art', { projectId: 'pr1' })] }] });
    const input = mount();
    fireEvent.change(input, { target: { value: 'runnin' } });
    await waitFor(() => expect(screen.getByText('Runnin art')).toBeTruthy());
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(push).toHaveBeenCalledWith('/o/night-shift/projects/pr1');
  });

  it('says so when search fails, without throwing', async () => {
    answer({ error: 'x' }, 500);
    const input = mount();
    fireEvent.change(input, { target: { value: 'runnin' } });
    await waitFor(() => expect(screen.getByText('Search is unavailable right now')).toBeTruthy());
  });

  it('Escape closes it', async () => {
    const input = mount();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(useCommandPalette.getState().open).toBe(false));
  });
});
