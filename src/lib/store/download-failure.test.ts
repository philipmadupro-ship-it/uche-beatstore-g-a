import { describe, it, expect, vi } from 'vitest';
import {
  DOWNLOAD_FALLBACK_MESSAGE,
  downloadFailureMessage,
  probeDownload,
} from './download-failure';

describe('downloadFailureMessage', () => {
  it('shows the route\'s own sentence for a 4xx', () => {
    expect(downloadFailureMessage(403, 'File download not permitted by this license'))
      .toBe('File download not permitted by this license');
  });

  it('never repeats a 5xx body, whatever it says', () => {
    expect(downloadFailureMessage(500, 'relation "x" does not exist')).toBe(DOWNLOAD_FALLBACK_MESSAGE);
  });

  it('has a sentence for each status when the body is empty', () => {
    expect(downloadFailureMessage(403)).toMatch(/no longer available/);
    expect(downloadFailureMessage(401)).toMatch(/no longer available/);
    expect(downloadFailureMessage(429)).toMatch(/Too many/);
    expect(downloadFailureMessage(404)).toMatch(/not available right now/);
    expect(downloadFailureMessage(502)).toBe(DOWNLOAD_FALLBACK_MESSAGE);
  });
});

describe('probeDownload', () => {
  it('asks for one byte and passes when the route serves it', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 206, body: { cancel } });
    const result = await probeDownload('/api/store/download-file?x=1', fetchMock as unknown as typeof fetch);

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith('/api/store/download-file?x=1', {
      headers: { Range: 'bytes=0-0', 'X-Download-Probe': '1' },
      cache: 'no-store',
    });
    expect(cancel).toHaveBeenCalled();
  });

  it('fails with the route\'s message on a 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 403, json: () => Promise.resolve({ error: 'Download access revoked (refunded or disputed)' }),
    });
    expect(await probeDownload('/x', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false, message: 'Download access revoked (refunded or disputed)',
    });
  });

  it('fails with the status alone when the body is not JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 404, json: () => Promise.reject(new SyntaxError('Unexpected token <')),
    });
    const result = await probeDownload('/x', fetchMock as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/not available right now/);
  });

  it('fails softly when the network drops', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await probeDownload('/x', fetchMock as unknown as typeof fetch)).toEqual({
      ok: false, message: DOWNLOAD_FALLBACK_MESSAGE,
    });
  });
});
