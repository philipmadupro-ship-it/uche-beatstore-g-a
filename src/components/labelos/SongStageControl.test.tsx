// @vitest-environment jsdom

/**
 * The stage Dropdown (LABEL-24, 07 §2.3): it lists only the moves this member
 * may make, is a plain chip when they have none, and a failed move toasts and
 * leaves the stage alone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { capabilitiesFor, type Capability, type Role } from '@/lib/labelos/capabilities';
import { useToastStore } from '@/hooks/useToast';
import { OrgShellProvider, type OrgShellValue } from './OrgShellContext';
import { SongStageControl } from './SongStageControl';

function shell(role: Role, functions: string[] = []): OrgShellValue {
  return {
    org: { id: 'o1', name: 'Night Shift', slug: 'night-shift', kind: 'label' },
    role,
    scope: role === 'artist' ? 'artists' : 'org',
    capabilities: [...capabilitiesFor('label', role, functions)] as Capability[],
    viewerIsProducer: false,
  };
}

function open(stage: string, who: OrgShellValue | null, onMoved?: (s: string) => void) {
  const ui = <SongStageControl orgId="o1" songId="s1" stage={stage} testId="stage" onMoved={onMoved} />;
  return render(who ? <OrgShellProvider value={who}>{ui}</OrgShellProvider> : ui);
}

const menu = () => screen.queryAllByRole('option').map((b) => b.textContent);
const toasts = () => useToastStore.getState().toasts.map((t) => `${t.kind}:${t.title}`);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SongStageControl', () => {
  it('lists the allowed transitions only, in pipeline order', () => {
    open('in_review', shell('owner'));
    fireEvent.click(screen.getByRole('button', { name: /Stage: In review/ }));
    expect(menu()).toEqual(['Shortlisted', 'Passed', 'On hold', 'Archived']);
    expect(screen.queryByText('Selected')).toBeNull();
    expect(screen.queryByText('Inbox')).toBeNull();
  });

  it('shows a roster artist one move, inbox → in review', () => {
    open('inbox', shell('artist'));
    fireEvent.click(screen.getByRole('button', { name: /Stage: Inbox/ }));
    expect(menu()).toEqual(['In review']);
  });

  it('is a plain chip, no menu, when the member has no move', () => {
    open('in_review', shell('artist'));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('stage').textContent).toBe('In review');
    cleanup();
    open('inbox', shell('member', ['marketing']));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('stage').textContent).toBe('Inbox');
  });

  it('is a plain chip outside the org shell', () => {
    open('selected', null);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTestId('stage').textContent).toBe('Selected');
  });

  it('moves the song: posts { to, from }, shows the new stage and says so', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ to: 'shortlisted' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onMoved = vi.fn();
    open('in_review', shell('owner'), onMoved);
    fireEvent.click(screen.getByRole('button', { name: /Stage: In review/ }));
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Shortlisted' })); });
    await waitFor(() => expect(screen.getByRole('button', { name: /Stage: Shortlisted/ })).toBeTruthy());
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ to: 'shortlisted', from: 'in_review' });
    expect(onMoved).toHaveBeenCalledWith('shortlisted');
    expect(toasts()).toEqual(['success:Moved to Shortlisted']);
  });

  it('a failed move toasts the reason and leaves the stage as it was', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Someone else moved this song first. It was not moved to Passed.' }), { status: 409 })));
    const onMoved = vi.fn();
    open('in_review', shell('owner'), onMoved);
    fireEvent.click(screen.getByRole('button', { name: /Stage: In review/ }));
    await act(async () => { fireEvent.click(screen.getByRole('option', { name: 'Passed' })); });
    await waitFor(() => expect(toasts()).toEqual(['error:Someone else moved this song first. It was not moved to Passed.']));
    expect(screen.getByRole('button', { name: /Stage: In review/ })).toBeTruthy();
    expect(onMoved).not.toHaveBeenCalled();
  });
});
