// @vitest-environment jsdom

/**
 * Inviting someone who is already in the directory (LABEL-50): a roster artist
 * gets an artist login limited to their contact; a collaborator gets a project
 * invitation. Neither creates a contact.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock('@/hooks/useToast', () => ({ toast, confirmToast: vi.fn() }));

import { ContactInviteModal } from './ContactInviteModal';

let calls: { url: string; method: string; body: Record<string, unknown> }[];
let answer: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  answer = { status: 201, body: {} };
  toast.success.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify(answer.body), { status: answer.status });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ContactInviteModal', () => {
  it('a roster artist is invited as role artist, limited to that contact, and nothing is created', async () => {
    const onClose = vi.fn();
    render(<ContactInviteModal orgId="o1" target={{ id: 'c1', name: 'Nova', email: null, mode: 'login' }} projects={null} onClose={onClose} />);
    const send = screen.getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'nova@x.test' } });
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual([{ url: '/api/org/o1/invitations', method: 'POST', body: { email: 'nova@x.test', role: 'artist', functions: [], contact_ids: ['c1'] } }]);
  });

  it('prefills the contact\'s address and shows the server\'s refusal instead of closing', async () => {
    answer = { status: 409, body: { error: 'This address already has a pending invitation.' } };
    const onClose = vi.fn();
    render(<ContactInviteModal orgId="o1" target={{ id: 'c1', name: 'Nova', email: 'nova@x.test', mode: 'login' }} projects={null} onClose={onClose} />);
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('nova@x.test');
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/already has a pending invitation/));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a collaborator needs a project before the invitation can go, and it goes to that project', async () => {
    const onClose = vi.fn();
    render(
      <ContactInviteModal orgId="o1" target={{ id: 'c2', name: 'Rex', email: 'rex@x.test', mode: 'project' }} projects={[{ id: 'p1', name: 'Night Shift' }]} onClose={onClose} />,
    );
    const send = screen.getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Night Shift' }));
    await waitFor(() => expect(send.disabled).toBe(false));
    fireEvent.click(send);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls).toEqual([{ url: '/api/org/o1/projects/p1/members', method: 'POST', body: { email: 'rex@x.test', role: 'viewer', allow_downloads: false } }]);
  });
});
