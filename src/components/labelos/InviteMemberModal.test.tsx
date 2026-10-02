// @vitest-environment jsdom

/**
 * The invite dialog offers exactly what the org kind may invite (the route
 * refuses the rest), drops functions for roles that do not take them, and
 * tells the inviter when the email did not go out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { InviteMemberModal } from './InviteMemberModal';

const ORG = '22222222-2222-4222-8222-222222222222';
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      invitation: { id: 'i1', email: 'nova@example.com', role: 'member', functions: ['a_and_r'], contact_ids: [], expires_at: 'x' },
      emailSent: true,
    }),
  }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(kind: 'label' | 'producer' | 'artist' = 'label', onInvited = vi.fn()) {
  render(<InviteMemberModal open onClose={vi.fn()} orgId={ORG} orgKind={kind} orgName="Night Shift" onInvited={onInvited} />);
  return onInvited;
}

const roleNames = () => screen.getAllByRole('radio').map((r) => r.textContent);

describe('InviteMemberModal', () => {
  it('is a labelled dialog', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Invite to organization' })).toBeTruthy();
  });

  it('offers the kind’s roles, never Owner', () => {
    open('label');
    expect(roleNames()).toEqual(['Admin', 'Member', 'Artist']);
    cleanup();
    open('producer');
    expect(roleNames()).toEqual(['Admin', 'Member']);
  });

  it('offers the kind’s functions for a member only', () => {
    open('producer');
    expect(screen.getByRole('button', { name: 'Engineer' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'A&R' })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Admin' }));
    expect(screen.queryByRole('button', { name: 'Engineer' })).toBeNull();
  });

  it('posts email, role and functions to the org’s invitations route', async () => {
    const onInvited = open('label');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: ' nova@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'A&R' }));
    expect(screen.getByRole('button', { name: 'A&R' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(onInvited).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(`/api/org/${ORG}/invitations`, expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: 'nova@example.com', role: 'member', functions: ['a_and_r'] });
    expect(screen.getByRole('status').textContent).toMatch(/in their inbox/);
  });

  it('sends no functions for an artist even if some were picked first', async () => {
    open('label');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Legal' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Artist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ role: 'artist', functions: [] });
  });

  it('keeps Send disabled until the email is valid', () => {
    open();
    const send = screen.getByRole('button', { name: 'Send invitation' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.test' } });
    expect(send.disabled).toBe(false);
  });

  it('shows the server’s refusal', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'This address already has a pending invitation.' }) });
    open();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/pending invitation/);
  });

  it('says when the email did not go out', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ invitation: { id: 'i', email: 'a@b.test', role: 'member', functions: [], contact_ids: [], expires_at: 'x' }, emailSent: false }),
    });
    open();
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    expect((await screen.findByRole('status')).textContent).toMatch(/could not be sent/);
  });
});
