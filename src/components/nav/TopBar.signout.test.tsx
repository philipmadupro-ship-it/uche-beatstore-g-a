// @vitest-environment jsdom

/**
 * Sign-out for every viewer of the org shell: a marketing-only member and a
 * roster artist get a visible Sign out in the account menu and in the mobile
 * drawer — and none of the producer's own links (Profile, Settings).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { capabilitiesFor, type Capability, type Role } from '@/lib/labelos/capabilities';
import { OrgShellProvider, type OrgShellValue } from '@/components/labelos/OrgShellContext';
import { TopBar } from './TopBar';

vi.mock('next/navigation', () => ({ usePathname: () => '/o/night-shift', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeTable', () => ({ useRealtimeTable: () => {} }));
vi.mock('@/components/activity/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('./SessionContextControl', () => ({ SessionContextControl: () => null }));
vi.mock('./OrgSwitcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/hooks/useBrandArtwork', () => ({ useBrandArtwork: () => ({ logoUrl: null }) }));
const signOut = vi.fn(async () => ({ error: null }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false, signOut }) }));

const shell = (role: Role, functions: string[], scope: 'org' | 'artists'): OrgShellValue => ({
  org: { id: 'o1', name: 'Night Shift', slug: 'night-shift', kind: 'label' },
  role,
  scope,
  capabilities: [...capabilitiesFor('label', role, functions as never)] as Capability[],
  viewerIsProducer: false,
});

beforeEach(() => {
  signOut.mockClear();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notifications: [], unread: 0, hasMore: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const viewers: [string, OrgShellValue][] = [
  ['a marketing-only member', shell('member', ['marketing'], 'org')],
  ['a roster artist', shell('artist', [], 'artists')],
];

describe.each(viewers)('org-shell TopBar for %s', (_label, value) => {
  it('account menu: Sign out, no Profile / Settings', async () => {
    render(<OrgShellProvider value={value}><TopBar /></OrgShellProvider>);
    fireEvent.click(screen.getByRole('button', { name: /open account menu/i }));
    const out = await screen.findByRole('button', { name: /^sign out$/i });
    expect(screen.queryByRole('link', { name: /^profile$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^settings$/i })).toBeNull();
    fireEvent.click(out);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('mobile drawer: Sign out, no Profile / Settings', async () => {
    render(<OrgShellProvider value={value}><TopBar /></OrgShellProvider>);
    fireEvent.click(screen.getByRole('button', { name: /open navigation menu/i }));
    const out = await screen.findByRole('button', { name: /^sign out$/i });
    expect(screen.queryByRole('link', { name: /^profile$/i })).toBeNull();
    fireEvent.click(out);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
