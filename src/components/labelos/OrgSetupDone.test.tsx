// @vitest-environment jsdom

/**
 * The wizard's last screen (LABEL-48): passwords of created logins are shown
 * once, in the page only; the lost-response case says plainly that nothing was
 * added and links to where to add it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { StepResult } from '@/lib/labelos/setup-wizard-client';

const toastSuccess = vi.fn();
const copy = vi.fn<(text: string) => Promise<boolean>>(async () => true);
vi.mock('@/hooks/useToast', () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: (t: string) => copy(t) }));

const { OrgSetupDone, EXISTING_NOT_ADDED } = await import('./OrgSetupDone');

const result = (over: Partial<StepResult>): StepResult => ({ kind: 'invitation', label: 'a@x.test', ok: true, message: 'Invitation sent', fixIn: 'Members', ...over });

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => cleanup());

describe('OrgSetupDone', () => {
  it('lists each created login with its password and a Copy button, and nothing for an invitation or a failure', async () => {
    render(
      <OrgSetupDone
        home="/o/x"
        onOpen={() => {}}
        results={[
          result({ kind: 'login', label: 'lee@x.test', password: 'a-good-password-1', message: 'Login created.' }),
          result({ kind: 'login', label: 'kim@x.test', ok: false, message: 'taken' }),
          result({ kind: 'invitation', label: 'm@x.test' }),
        ]}
      />,
    );
    const logins = screen.getAllByTestId('wizard-login');
    expect(logins).toHaveLength(1);
    expect(logins[0].textContent).toContain('lee@x.test');
    expect(screen.getByTestId('wizard-login-password').textContent).toBe('a-good-password-1');
    expect(screen.getByTestId('wizard-logins').textContent).toMatch(/shown once/i);

    fireEvent.click(screen.getByRole('button', { name: 'Copy the login for lee@x.test' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('lee@x.test\na-good-password-1'));
    expect(toastSuccess).toHaveBeenCalledWith('Copied');
  });

  it('writes the password nowhere: not localStorage, not sessionStorage', () => {
    render(<OrgSetupDone home="/o/x" onOpen={() => {}} results={[result({ kind: 'login', password: 'a-good-password-1' })]} />);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain('a-good-password-1');
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain('a-good-password-1');
  });

  it('is gone when the screen is left', () => {
    const { unmount } = render(<OrgSetupDone home="/o/x" onOpen={() => {}} results={[result({ kind: 'login', password: 'a-good-password-1' })]} />);
    unmount();
    expect(document.body.textContent).not.toContain('a-good-password-1');
  });

  it('no logins, no password section', () => {
    render(<OrgSetupDone home="/o/x" onOpen={() => {}} results={[result({})]} />);
    expect(screen.queryByTestId('wizard-logins')).toBeNull();
  });

  it('an existing org: says plainly nothing was added, and links to where to add it', () => {
    render(<OrgSetupDone home="/o/northside" existing results={[]} onOpen={() => {}} />);
    expect(screen.getByTestId('wizard-done-note').textContent).toBe(EXISTING_NOT_ADDED);
    expect(EXISTING_NOT_ADDED).toMatch(/NOT added/);
    for (const word of ['roster artists', 'invitations', 'team logins', 'first release']) expect(EXISTING_NOT_ADDED).toContain(word);
    const hrefs = Array.from(screen.getByTestId('wizard-existing-links').querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/o/northside/settings/members', '/o/northside/artists', '/o/northside/releases']);
  });

  it('Open your workspace calls back', () => {
    const onOpen = vi.fn();
    render(<OrgSetupDone home="/o/x" results={[]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open your workspace' }));
    expect(onOpen).toHaveBeenCalled();
  });
});
