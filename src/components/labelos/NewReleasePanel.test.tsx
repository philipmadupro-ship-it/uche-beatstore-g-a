// @vitest-environment jsdom

/**
 * "New release" (LABEL-55): the form builds the request the route takes, names
 * a bad territory or language before sending, shows the server's own words
 * (a bad UPC) on the form, and opens the new release on success.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NewReleasePanel } from './NewReleasePanel';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useToast', () => ({ toast }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

let calls: { url: string; method: string; body: Record<string, unknown> }[];
let reply: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  reply = { status: 201, body: { release: { id: 'r1' } } };
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as never;
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: JSON.parse(String(init?.body ?? '{}')) });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body } as Response;
  });
  toast.success.mockReset();
  toast.error.mockReset();
  push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const artists = [{ id: 'c1', name: 'Nova' }, { id: 'c2', name: 'Kilo' }];
const open = () => {
  render(<NewReleasePanel orgId="org1" orgSlug="acme" artists={artists} />);
  fireEvent.click(screen.getByTestId('release-new-open'));
};
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

describe('NewReleasePanel', () => {
  it('draws nothing when there is no artist to release for', () => {
    const { container } = render(<NewReleasePanel orgId="org1" orgSlug="acme" artists={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('needs a title; creates a draft with what was typed, then opens it', async () => {
    open();
    expect((screen.getByTestId('release-new-submit') as HTMLButtonElement).disabled).toBe(true);
    type('release-new-title', '  Night Shift ');
    type('release-new-upc', '036000291452');
    type('release-new-label', 'Board Records');
    type('release-new-territories', 'us gb');
    type('release-new-language', 'EN');
    type('release-new-distributor', 'DistroKid');
    type('release-new-date', '2026-12-01');
    await act(async () => {
      fireEvent.click(screen.getByTestId('release-new-submit'));
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/o/acme/releases/r1'));
    expect(calls).toEqual([
      {
        url: '/api/org/org1/releases',
        method: 'POST',
        body: {
          title: 'Night Shift', contact_id: 'c1', type: 'single', label_name: 'Board Records', upc: '036000291452', territories: ['US', 'GB'],
          language: 'en', distributor: 'DistroKid', target_date: '2026-12-01',
        },
      },
    ]);
  });

  it('names a bad territory on the form and sends nothing', async () => {
    open();
    type('release-new-title', 'Night Shift');
    type('release-new-territories', 'US, USA');
    await act(async () => {
      fireEvent.click(screen.getByTestId('release-new-submit'));
    });
    expect(screen.getByTestId('release-new-error').textContent).toMatch(/“USA” is not a two-letter country code/);
    expect(screen.getByTestId('release-new-error').getAttribute('data-field')).toBe('territories');
    expect(calls).toEqual([]);
  });

  it('shows the server’s refusal (a UPC with a bad check digit) and stays on the form', async () => {
    reply = { status: 400, body: { error: 'not a valid UPC/EAN (12 or 13 digits with a valid check digit)' } };
    open();
    type('release-new-title', 'Night Shift');
    type('release-new-upc', '036000291453');
    await act(async () => {
      fireEvent.click(screen.getByTestId('release-new-submit'));
    });
    await waitFor(() => expect(screen.getByTestId('release-new-error').textContent).toMatch(/not a valid UPC/));
    expect(toast.error).toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
