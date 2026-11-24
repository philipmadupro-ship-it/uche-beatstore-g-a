// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DuplicateSendNotice, type DuplicateRow } from './DuplicateSendNotice';

afterEach(cleanup);

const NOW = Date.parse('2026-11-24T12:00:00Z');
const row = (over: Partial<DuplicateRow> = {}): DuplicateRow => ({
  key: 'c1',
  tracks: [{ id: 't1', title: 'Night Shift' }],
  last_sent_at: new Date(NOW - 3 * 86_400_000).toISOString(),
  email_opened: true,
  link_clicked: false,
  activity: { opens: 1, plays: 2, downloads: 0 },
  ...over,
});

function setup(props: Partial<Parameters<typeof DuplicateSendNotice>[0]> = {}) {
  const h = { onRemoveTracks: vi.fn(), onSkip: vi.fn(), onUndo: vi.fn() };
  render(
    <DuplicateSendNotice
      rows={[row()]}
      names={{ c1: 'Nova', c2: 'Kai' }}
      removed={{}}
      skipped={new Set()}
      bulk={false}
      canRemoveTracks
      now={NOW}
      {...h}
      {...props}
    />,
  );
  return h;
}

describe('DuplicateSendNotice', () => {
  it('renders nothing without duplicates', () => {
    const { container } = render(
      <DuplicateSendNotice rows={[]} names={{}} removed={{}} skipped={new Set()} bulk={false} canRemoveTracks onRemoveTracks={vi.fn()} onSkip={vi.fn()} onUndo={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('says who has what, when, and what happened', () => {
    setup();
    const text = screen.getByLabelText('Already sent').textContent ?? '';
    expect(text).toContain('Already sent to Nova: Night Shift');
    expect(text).toContain('(3 days ago · opened · played 2×)');
    expect(text).toContain('only a heads-up');
  });

  it('removes the overlapping tracks for that recipient', () => {
    const h = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Remove these tracks' }));
    expect(h.onRemoveTracks).toHaveBeenCalledWith('c1', ['t1']);
  });

  it('offers no per-track removal for a project send', () => {
    setup({ canRemoveTracks: false });
    expect(screen.queryByRole('button', { name: 'Remove these tracks' })).toBeNull();
  });

  it('bulk: skips every recipient who has them, in one click, and only when bulk', () => {
    const rows = [row(), row({ key: 'c2' })];
    const h = setup({ rows, bulk: true });
    fireEvent.click(screen.getByRole('button', { name: 'Skip recipients who have them' }));
    expect(h.onSkip).toHaveBeenCalledWith(['c1', 'c2']);
    cleanup();
    setup({ rows, bulk: false });
    expect(screen.queryByRole('button', { name: 'Skip recipients who have them' })).toBeNull();
  });

  it('a resolved row says what will happen and can be undone', () => {
    const h = setup({ rows: [row(), row({ key: 'c2' })], bulk: true, skipped: new Set(['c1']), removed: { c2: ['t1'] } });
    const text = screen.getByLabelText('Already sent').textContent ?? '';
    expect(text).toContain('Skipping Nova');
    expect(text).toContain('Leaving Night Shift out for Kai');
    const undo = screen.getAllByRole('button', { name: /Undo/ });
    expect(undo).toHaveLength(2);
    fireEvent.click(undo[0]);
    expect(h.onUndo).toHaveBeenCalledWith('c1');
    // everything is resolved: nothing left to bulk-skip
    expect(screen.queryByRole('button', { name: 'Skip recipients who have them' })).toBeNull();
  });

  it('folds a long title list', () => {
    setup({ rows: [row({ tracks: ['A', 'B', 'C', 'D', 'E'].map((t, i) => ({ id: `t${i}`, title: t })) })] });
    expect(screen.getByLabelText('Already sent').textContent).toContain('A, B, C +2 more');
  });
});
