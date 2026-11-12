// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LabelOsFlagProvider } from '@/components/labelos/LabelOsFlag';
import { OrgsSettingsCard } from '@/components/labelos/OrgsSettingsCard';
import { OrgSwitcher } from './OrgSwitcher';

let pathname = '/library';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));

const STUDIO = { id: 'b', name: 'Uche Studio', slug: 'uche', kind: 'producer', role: 'owner', home: '/library' };
const LABEL = { id: 'a', name: 'Night Shift', slug: 'night-shift', kind: 'label', role: 'member', home: '/o/night-shift' };

let fetchMock: ReturnType<typeof vi.fn>;
function answer(orgs: unknown[]) {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ orgs, shared: [] }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
}

beforeEach(() => {
  pathname = '/library';
  answer([STUDIO]);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrgSwitcher', () => {
  it('with Label OS off: renders nothing and requests nothing', async () => {
    const { container } = render(<LabelOsFlagProvider enabled={false}><OrgSwitcher /><OrgsSettingsCard /></LabelOsFlagProvider>);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('outside any provider (the old default) also renders nothing', async () => {
    const { container } = render(<OrgSwitcher />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('hidden for a user with exactly one org and nothing shared', async () => {
    const { container } = render(<LabelOsFlagProvider enabled><OrgSwitcher /></LabelOsFlagProvider>);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/org', { cache: 'no-store' }));
    await new Promise((r) => setTimeout(r, 10));
    expect(container.innerHTML).toBe('');
  });

  it('with two orgs: names the current one and links to each org’s home', async () => {
    answer([LABEL, STUDIO]);
    render(<LabelOsFlagProvider enabled><OrgSwitcher /></LabelOsFlagProvider>);
    const trigger = await screen.findByRole('button', { name: /Organization: Uche Studio/ });
    fireEvent.click(trigger);
    const nav = await screen.findByRole('navigation', { name: 'Organizations' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('aria-current')])).toEqual([
      ['Night ShiftLabel · Member', '/o/night-shift', null],
      ['Uche StudioStudio · Owner', '/library', 'page'],
    ]);
  });

  it('inside an org shell the URL decides the current org', async () => {
    answer([LABEL, STUDIO]);
    pathname = '/o/night-shift/settings/members';
    render(<LabelOsFlagProvider enabled><OrgSwitcher /></LabelOsFlagProvider>);
    expect(await screen.findByRole('button', { name: /Organization: Night Shift/ })).toBeTruthy();
  });
});

describe('OrgsSettingsCard', () => {
  it('with Label OS on, links each org to its members page', async () => {
    render(<LabelOsFlagProvider enabled><OrgsSettingsCard /></LabelOsFlagProvider>);
    const link = await screen.findByRole('link', { name: /Uche Studio/ });
    expect(link.getAttribute('href')).toBe('/o/uche/settings/members');
  });
});
