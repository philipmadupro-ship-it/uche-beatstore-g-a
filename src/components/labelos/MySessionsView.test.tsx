// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { OrgSession } from '@/lib/labelos/my-sessions';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/hooks/useToast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { MySessionsView } from './MySessionsView';

const sessions: OrgSession[] = [
  {
    orgId: 'o1',
    orgName: 'Night Shift',
    askCount: 3,
    projects: [
      {
        id: 'p1', orgId: 'o1', name: 'Midnight EP', orgName: 'Night Shift', role: 'contributor', href: '/shared/p1',
        asks: [
          { key: 'credit:c1:p1', kind: 'credit', projectId: 'p1', trackId: 't1', trackTitle: 'Midnight', label: 'Confirm your credit: Producer', refId: 'c1', sheetId: null },
          { key: 'split:l1:p1', kind: 'split', projectId: 'p1', trackId: 't1', trackTitle: 'Midnight', label: 'Acknowledge your split', refId: 'l1', sheetId: 's1' },
          { key: 'contract:k1:p1', kind: 'contract', projectId: 'p1', trackId: 't1', trackTitle: 'Midnight', label: 'Sign: Producer agreement', refId: 'k1', sheetId: null },
        ],
      },
    ],
  },
  { orgId: 'o2', orgName: 'Label B', askCount: 0, projects: [{ id: 'p2', orgId: 'o2', name: 'Other', orgName: 'Label B', role: 'viewer', href: '/shared/p2', asks: [] }] },
];

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  refresh.mockClear();
});

describe('MySessionsView', () => {
  it('groups projects by org and shows what is waiting', () => {
    render(<MySessionsView sessions={sessions} />);
    expect(screen.getByTestId('session-org-o1')).toBeTruthy();
    expect(screen.getByText('3 waiting')).toBeTruthy();
    expect(screen.getByText('Label B')).toBeTruthy();
    expect(screen.getAllByTestId(/^ask-/)).toHaveLength(3);
  });

  it('confirming a credit PATCHes the credit route; acknowledging posts the line', async () => {
    render(<MySessionsView sessions={sessions} />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/org/o1/tracks/t1/credits/c1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'confirm' });
    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1][0]).toBe('/api/org/o1/tracks/t1/splits/s1/signatures');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ method: 'acknowledged', line_id: 'l1' });
  });

  it('a contract has no button here: signing goes through the emailed link', () => {
    render(<MySessionsView sessions={sessions} />);
    expect(screen.getByText(/signing link in your email/i)).toBeTruthy();
  });

  it('is an honest empty state', () => {
    render(<MySessionsView sessions={[]} />);
    expect(screen.getByTestId('shared-empty')).toBeTruthy();
  });
});
