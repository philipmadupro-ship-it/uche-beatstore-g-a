// @vitest-environment jsdom

/**
 * STORE-05: the producer's top bar carries no "Beatstore" text next to the
 * logo mark (the mark already says U2C), the logo link keeps an accessible
 * name, and inside an org shell the org name is still shown.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OrgShellProvider, type OrgShellValue } from '@/components/labelos/OrgShellContext';
import { capabilitiesFor, type Capability } from '@/lib/labelos/capabilities';
import { TopBar } from './TopBar';

vi.mock('next/navigation', () => ({ usePathname: () => '/library', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/useRealtimeTable', () => ({ useRealtimeTable: () => {} }));
vi.mock('@/components/activity/ActivityPanel', () => ({ ActivityPanel: () => null }));
vi.mock('./SessionContextControl', () => ({ SessionContextControl: () => null }));
vi.mock('./OrgSwitcher', () => ({ OrgSwitcher: () => null }));
vi.mock('@/hooks/useBrandArtwork', () => ({ useBrandArtwork: () => ({ logoUrl: null }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }) }));

beforeEach(() => {
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ notifications: [], unread: 0, hasMore: false }), { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TopBar brand', () => {
  it('producer bar: no "beatstore" text, logo link keeps its name', () => {
    const { container } = render(<TopBar />);
    const header = container.querySelector('header')!;
    expect(header.textContent ?? '').not.toMatch(/beatstore/i);
    expect(screen.getByRole('link', { name: 'U2C Beatstore home' })).toBeTruthy();
    expect(header.textContent).toContain('U2C'); // the mark itself
  });

  it('org shell: the org name is still shown', () => {
    const shell: OrgShellValue = {
      org: { id: 'o1', name: 'Night Shift', slug: 'night-shift', kind: 'label' },
      role: 'member',
      scope: 'org',
      capabilities: [...capabilitiesFor('label', 'member', [] as never)] as Capability[],
      viewerIsProducer: false,
    };
    const { container } = render(<OrgShellProvider value={shell}><TopBar /></OrgShellProvider>);
    expect(container.querySelector('header')!.textContent).toContain('Night Shift');
    expect(screen.getByRole('link', { name: 'Night Shift home' })).toBeTruthy();
  });
});
