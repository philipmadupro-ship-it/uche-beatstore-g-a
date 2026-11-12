// @vitest-environment jsdom

/**
 * The export buttons and the calendar link control (LABEL-34): drawn only for
 * someone who may use them, they call the routes and surface the server's
 * own words. The rules are the routes' (their tests); the file name is the
 * server's, never built here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReleaseExportButtons } from './ReleaseExportButtons';
import { ReleaseCalendarLink } from './ReleaseCalendarLink';
import { exportUrl, filenameFrom } from '@/lib/labelos/metadata-export-client';

const ORG = '10000000-0000-4000-8000-000000000001';
const REL = '70000000-0000-4000-8000-000000000001';
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/hooks/useToast', () => ({ toast }));
const copy = vi.hoisted(() => vi.fn(async () => true));
vi.mock('@/lib/clipboard', () => ({ copyToClipboard: copy }));

let calls: { url: string; method: string }[];
let handler: (url: string, method: string) => { status: number; body?: unknown; headers?: Record<string, string>; text?: string };

beforeEach(() => {
  calls = [];
  handler = () => ({ status: 200, text: 'csv', headers: { 'content-disposition': 'attachment; filename="nova-ep-metadata.csv"' } });
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    const r = handler(url, method);
    return new Response(r.body !== undefined ? JSON.stringify(r.body) : r.text ?? '', { status: r.status, headers: r.headers });
  }) as never;
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  toast.success.mockClear();
  toast.error.mockClear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('helpers', () => {
  it('builds the export URL and reads a bare file name from the header', () => {
    expect(exportUrl(ORG, REL, 'json')).toBe(`/api/org/${ORG}/releases/${REL}/export?format=json`);
    expect(filenameFrom('attachment; filename="a-metadata.csv"', 'x')).toBe('a-metadata.csv');
    expect(filenameFrom('attachment; filename="../../etc/passwd"', 'x')).toBe('x');
    expect(filenameFrom(null, 'fallback.csv')).toBe('fallback.csv');
  });
});

describe('ReleaseExportButtons', () => {
  it('draws nothing for someone who may not export', () => {
    const { container } = render(<ReleaseExportButtons orgId={ORG} releaseId={REL} canExport={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('downloads the CSV the server named, then says so', async () => {
    render(<ReleaseExportButtons orgId={ORG} releaseId={REL} canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Metadata exported', 'nova-ep-metadata.csv'));
    expect(calls).toEqual([{ url: `/api/org/${ORG}/releases/${REL}/export?format=csv`, method: 'GET' }]);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('asks for JSON from its own button', async () => {
    render(<ReleaseExportButtons orgId={ORG} releaseId={REL} canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }));
    await waitFor(() => expect(calls[0]?.url).toMatch(/format=json$/));
  });

  it('shows the server’s own words on a refusal and downloads nothing', async () => {
    handler = () => ({ status: 403, body: { error: 'Forbidden' } });
    render(<ReleaseExportButtons orgId={ORG} releaseId={REL} canExport />);
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not export the metadata', 'Forbidden'));
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });
});

describe('ReleaseCalendarLink', () => {
  it('offers to create a link when there is none, then lets the member copy, replace or turn it off', async () => {
    let active = false;
    handler = (_url, method) => {
      if (method === 'POST') active = true;
      if (method === 'DELETE') active = false;
      return { status: 200, body: active ? { active: true, path: `/api/org/${ORG}/calendar.ics?token=t` } : { active: false } };
    };
    render(<ReleaseCalendarLink orgId={ORG} />);
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create calendar link' }));
    const copyButton = await screen.findByRole('button', { name: 'Copy link' });
    fireEvent.click(copyButton);
    await waitFor(() => expect(copy).toHaveBeenCalledWith(`${window.location.origin}/api/org/${ORG}/calendar.ics?token=t`));
    fireEvent.click(screen.getByRole('button', { name: 'Replace link' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('button', { name: 'Create calendar link' })).toBeTruthy();
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST', 'POST', 'DELETE']);
  });

  it('says so, and stays closed, when the member cannot read the link state', async () => {
    handler = () => ({ status: 403, body: { error: 'Forbidden' } });
    render(<ReleaseCalendarLink orgId={ORG} />);
    fireEvent.click(screen.getByRole('button', { name: 'Calendar link' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Could not read the calendar link', 'Forbidden'));
    expect(screen.queryByRole('button', { name: 'Create calendar link' })).toBeNull();
  });
});
