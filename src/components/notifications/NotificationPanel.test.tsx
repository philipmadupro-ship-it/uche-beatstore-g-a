// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach } from 'vitest';
import { NotificationPanel, type PanelNotification } from './NotificationPanel';
import { PRODUCER_NOTIFICATION_KINDS, presentNotification } from '@/lib/notifications/presentation';

afterEach(cleanup);

const C = '11111111-1111-4111-8111-111111111111';
const rows: PanelNotification[] = PRODUCER_NOTIFICATION_KINDS.map((kind, i) => ({
  id: `n${i}`, kind, title: `Title ${kind}`, body: `Body ${kind}`, data: { contact_id: C }, read: i % 2 === 1,
  created_at: new Date(Date.now() - i * 3600_000).toISOString(),
}));

function setup(over: Partial<React.ComponentProps<typeof NotificationPanel>> = {}) {
  const props = {
    notifications: rows, unread: rows.filter((r) => !r.read).length, hasMore: false, orgBell: false, attention: 0,
    hrefFor: (n: PanelNotification) => presentNotification(n).href,
    onMarkRead: vi.fn(), onMarkAllRead: vi.fn(), onOpenActivity: vi.fn(), onNavigate: vi.fn(), ...over,
  };
  render(<NotificationPanel {...props} />);
  return props;
}

describe('NotificationPanel', () => {
  it('renders a row per kind with its label and full time for screen readers', () => {
    setup();
    for (const r of rows) expect(screen.getByText(`Title ${r.kind}`)).toBeTruthy();
    expect(screen.getAllByText(/Unread\./).length).toBe(rows.filter((r) => !r.read).length);
  });

  it('opening an unread row with a link marks it read and navigates', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Title purchase'));
    expect(p.onMarkRead).toHaveBeenCalledWith(['n0']);
    expect(p.onNavigate).toHaveBeenCalledWith('/sales');
  });

  it('a read row with a link navigates without re-marking', () => {
    const p = setup();
    fireEvent.click(screen.getByText('Title refund'));
    expect(p.onMarkRead).not.toHaveBeenCalled();
    expect(p.onNavigate).toHaveBeenCalledWith('/sales');
  });

  it('an unread row with no link is a mark-read button', () => {
    const p = setup({ hrefFor: () => null });
    fireEvent.click(screen.getByText('Title purchase'));
    expect(p.onMarkRead).toHaveBeenCalledWith(['n0']);
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('says what Mark all read will clear when the list is a page', () => {
    setup({ hasMore: true, unread: 57 });
    expect(screen.getByText(/Marks all 57 unread, not just these 11/)).toBeTruthy();
  });

  it('shows no hint when everything unread is on screen', () => {
    setup();
    expect(screen.queryByText(/Marks all/)).toBeNull();
  });
});
