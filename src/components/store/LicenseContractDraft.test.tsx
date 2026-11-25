// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { LicenseContractDraft } from './LicenseContractDraft';

const view = (over: Record<string, unknown> = {}) => ({
  draft: true, sample: true,
  tier: { name: 'Gold', source: 'licenses-row', issues: [] },
  template_source: 'tier-aware',
  markdown: '# License Agreement\n\n## Schedule of Terms\n\n### Gold\n- Audio streams: 250,000 streams\n',
  schedule: '## Schedule of Terms\n',
  verification: { ok: true, missing: [], contradicted: [] },
  alerts: [],
  ...over,
});

const fetchMock = vi.fn();
beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// The draft is requested shortly after opening (and after the last edit), so wait for the call.
async function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Contract draft' }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled(), { timeout: 2000 });
}

describe('LicenseContractDraft', () => {
  it('stays closed, and requests nothing, until opened', () => {
    render(<LicenseContractDraft tierId="t1" />);
    expect(screen.queryByTestId('license-contract-draft-text')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('opens to the status first, then the text, with the PDF and edit links', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ draft: view() }) });
    render(<LicenseContractDraft tierId="t1" />);
    await open();
    await waitFor(() => expect(screen.getByTestId('license-contract-draft-text')).toBeTruthy());
    const status = screen.getByTestId('license-contract-draft-status');
    const text = screen.getByTestId('license-contract-draft-text');
    expect(status.textContent).toContain('states this tier\u2019s terms exactly');
    // The problems/status sit above the text, which is bounded and scrolls on its own.
    expect(status.compareDocumentPosition(text) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(text.className).toMatch(/max-h-72/);
    expect(text.className).toMatch(/overflow-auto/);
    expect(text.textContent).toContain('Audio streams: 250,000 streams');
    expect(screen.getByRole('link', { name: /Download PDF draft/ }).getAttribute('href')).toBe('/api/licenses/t1/contract-draft?format=pdf');
    expect(screen.getByRole('link', { name: /Edit wording/ }).getAttribute('href')).toBe('/store-editor#license-template');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/licenses/t1/contract-draft');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({});
  });

  it('sends the wording being edited, so the draft follows the editor', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ draft: view() }) });
    const { rerender } = render(<LicenseContractDraft tierId="t1" template="# Mine" />);
    await open();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ template: '# Mine' });
    rerender(<LicenseContractDraft tierId="t1" template="# Mine, edited" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 2000 });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ template: '# Mine, edited' });
  });

  it('lists conflicts above the text', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ draft: view({
      verification: { ok: false, missing: [], contradicted: ['states 5,000 streams: "Up to 5,000 audio streams"'] },
      alerts: ['Your template wording states 5,000 streams: "Up to 5,000 audio streams"'],
    }) }) });
    render(<LicenseContractDraft tierId="t1" />);
    await open();
    await waitFor(() => expect(screen.getByTestId('license-contract-draft-status').textContent).toContain('5,000 streams'));
    expect(screen.getByTestId('license-contract-draft-status').textContent).not.toContain('exactly');
  });

  it('says so when the tier has unsaved edits, and reports an error plainly', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) });
    render(<LicenseContractDraft tierId="t1" dirty />);
    await open();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Not found'));
    expect(screen.getByTestId('license-contract-draft-dirty').textContent).toContain('unsaved changes');
  });
});
