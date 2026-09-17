// @vitest-environment jsdom

/**
 * The history panel's states.
 *
 * The IndexedDB layer is mocked rather than faked: what needs covering here is
 * how the panel BEHAVES when the store is empty, populated, or unavailable —
 * the last of which is a real path (private browsing in some browsers denies
 * IndexedDB) and the easiest one to get wrong, because it only shows up on a
 * machine the author is not using.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { defaultStoreLayout } from '@/lib/store-editor/layout';

const listSnapshots = vi.fn();
const loadSnapshot = vi.fn();
const deleteSnapshot = vi.fn();

vi.mock('@/lib/store-editor/history', async () => {
  const actual = await vi.importActual<typeof import('@/lib/store-editor/history')>(
    '@/lib/store-editor/history',
  );
  return {
    ...actual,
    listSnapshots: (...args: unknown[]) => listSnapshots(...args),
    loadSnapshot: (...args: unknown[]) => loadSnapshot(...args),
    deleteSnapshot: (...args: unknown[]) => deleteSnapshot(...args),
  };
});

vi.mock('@/hooks/useToast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { HistoryPanel } = await import('./HistoryPanel');

const summary = (minutesAgo: number, label = '8 sections') => ({
  id: `snap-${minutesAgo}`,
  takenAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  label,
  sectionCount: 8,
});

beforeEach(() => {
  listSnapshots.mockReset();
  loadSnapshot.mockReset();
  deleteSnapshot.mockReset();
});

describe('HistoryPanel', () => {
  it('says so plainly when there are no versions yet', async () => {
    listSnapshots.mockResolvedValue([]);
    render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    expect(await screen.findByText(/No versions yet/i)).toBeTruthy();
  });

  it('lists versions newest first and badges the latest', async () => {
    listSnapshots.mockResolvedValue([summary(2), summary(90), summary(3000)]);
    render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    await screen.findByText('Latest');
    expect(screen.getByText('2m ago')).toBeTruthy();
    expect(screen.getByText('1h ago')).toBeTruthy();
    expect(screen.getByText('2d ago')).toBeTruthy();
    // Exactly one "Latest" badge, on the first entry.
    expect(screen.getAllByText('Latest')).toHaveLength(1);
  });

  it('restores through the callback so it lands on the undo stack', async () => {
    // Restoring is not destructive by design: it goes through the builder's
    // `commit`, so an unwanted restore is one undo away rather than needing a
    // confirmation dialog in front of it.
    const layout = defaultStoreLayout();
    listSnapshots.mockResolvedValue([summary(5)]);
    loadSnapshot.mockResolvedValue(layout);
    const onRestore = vi.fn();

    render(<HistoryPanel refreshKey={0} onRestore={onRestore} />);
    const button = await screen.findByLabelText(/^Restore the version/);
    button.click();

    await waitFor(() => expect(onRestore).toHaveBeenCalledWith(layout));
    expect(loadSnapshot).toHaveBeenCalledWith('snap-5');
  });

  it('does not restore when the record cannot be read', async () => {
    listSnapshots.mockResolvedValue([summary(5)]);
    loadSnapshot.mockResolvedValue(null);
    const onRestore = vi.fn();

    render(<HistoryPanel refreshKey={0} onRestore={onRestore} />);
    (await screen.findByLabelText(/^Restore the version/)).click();

    await waitFor(() => expect(loadSnapshot).toHaveBeenCalled());
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('removes a deleted version from the list', async () => {
    listSnapshots.mockResolvedValue([summary(5), summary(60)]);
    deleteSnapshot.mockResolvedValue(undefined);

    render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    const buttons = await screen.findAllByLabelText(/^Delete the version/);
    expect(buttons).toHaveLength(2);
    buttons[0].click();

    await waitFor(() => expect(screen.getAllByLabelText(/^Delete the version/)).toHaveLength(1));
    expect(deleteSnapshot).toHaveBeenCalledWith('snap-5');
  });

  it('degrades to a notice when IndexedDB is unavailable', async () => {
    // Private browsing denies IndexedDB in some browsers. History is an aid,
    // so it must not take the builder down with it.
    listSnapshots.mockRejectedValue(new Error('denied'));
    render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    expect(await screen.findByText(/Version history is unavailable/i)).toBeTruthy();
    expect(screen.getByText(/Your work still saves normally/i)).toBeTruthy();
  });

  it('states up front that versions are per-browser', async () => {
    // Better said once, here, than discovered on a second machine.
    listSnapshots.mockResolvedValue([summary(5)]);
    render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    expect(await screen.findByText(/do not follow you to another device/i)).toBeTruthy();
  });

  it('re-reads when the refresh key changes', async () => {
    listSnapshots.mockResolvedValue([]);
    const { rerender } = render(<HistoryPanel refreshKey={0} onRestore={vi.fn()} />);
    await waitFor(() => expect(listSnapshots).toHaveBeenCalledTimes(1));
    rerender(<HistoryPanel refreshKey={1} onRestore={vi.fn()} />);
    await waitFor(() => expect(listSnapshots).toHaveBeenCalledTimes(2));
  });
});
