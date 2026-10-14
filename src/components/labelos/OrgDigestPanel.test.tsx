// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrgDigestPanel } from './OrgDigestPanel';
import { SLACK_TEST_URL } from '@/lib/labelos/mocks/slack-url';

const SLACK = SLACK_TEST_URL;
let state: Record<string, unknown>;
let calls: Array<{ url: string; method: string; body?: string }>;

beforeEach(() => {
  calls = [];
  state = { schemaReady: true, enabled: false, canManage: false };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url.endsWith('/digest') && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify(state));
    if (url.endsWith('/digest')) return new Response(JSON.stringify({ enabled: JSON.parse(String(init?.body)).enabled }));
    return new Response(JSON.stringify({ configured: init?.method !== 'DELETE' }));
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('OrgDigestPanel', () => {
  it('lets a member switch their own digest and shows no Slack control', async () => {
    render(<OrgDigestPanel orgId="o1" orgName="North Star" />);
    const box = await screen.findByRole('checkbox', { name: /weekly digest/i });
    expect(screen.queryByLabelText(/slack webhook/i)).toBeNull();
    fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.body === JSON.stringify({ enabled: true }))).toBe(true));
  });

  it('shows a manager the Slack field as write-only: only "saved" is known, never the URL', async () => {
    state = { schemaReady: true, enabled: false, canManage: true, channelConfigured: true };
    render(<OrgDigestPanel orgId="o1" orgName="North Star" />);
    expect((await screen.findByTestId('slack-status')).textContent).toBe('A webhook is saved.');
    const input = screen.getByLabelText(/slack webhook url/i) as HTMLInputElement;
    expect(input.value).toBe('');
    expect(input.type).toBe('password');
    fireEvent.change(input, { target: { value: SLACK } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/digest/slack') && c.method === 'PUT')).toBe(true));
    await waitFor(() => expect((screen.getByLabelText(/slack webhook url/i) as HTMLInputElement).value).toBe(''));
  });

  it('tells a manager when the saved webhook can no longer be opened', async () => {
    state = { schemaReady: true, enabled: false, canManage: true, channelConfigured: true, needsReset: true };
    render(<OrgDigestPanel orgId="o1" orgName="North Star" />);
    expect((await screen.findByTestId('slack-reset')).textContent).toMatch(/no longer be opened/);
  });

  it('says so when the migration is not applied', async () => {
    state = { schemaReady: false, enabled: false, canManage: false };
    render(<OrgDigestPanel orgId="o1" orgName="North Star" />);
    expect(await screen.findByText(/not available on this server yet/i)).toBeTruthy();
  });
});
