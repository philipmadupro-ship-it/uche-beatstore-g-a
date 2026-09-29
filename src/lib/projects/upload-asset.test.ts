import { describe, expect, it, vi } from 'vitest';
import { uploadProjectAsset } from './upload-asset';

const P = '6f1c1b2e-8c1f-4c43-9f0a-0a4b3c2d1e0f';
const asset = { id: 'a1', label: 'x' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('uploadProjectAsset', () => {
  it('sends a small file through the app as multipart', async () => {
    const f = vi.fn().mockResolvedValue(json({ asset }, 201));
    const out = await uploadProjectAsset(P, new File(['hello'], 'Lyrics.txt'), { inPortal: true, fetchImpl: f });
    expect(out).toEqual(asset);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`/api/projects/${P}/assets`);
    const form = init.body as FormData;
    expect(form.get('in_portal')).toBe('true');
    expect((form.get('file') as File).name).toBe('Lyrics.txt');
  });

  it('presigns, PUTs and registers a large file', async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024)], 'ref.wav');
    const f = vi.fn()
      .mockResolvedValueOnce(json({ uploadUrl: 'https://r2.test/put', url: `r2://priv/project-assets/${P}/abcdef.wav`, contentType: 'audio/wav' }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json({ asset }, 201));
    await uploadProjectAsset(P, big, { inPortal: false, fetchImpl: f });
    expect(f.mock.calls[0][0]).toBe(`/api/projects/${P}/assets/presign`);
    expect(f.mock.calls[1][0]).toBe('https://r2.test/put');
    expect(f.mock.calls[1][1]).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'audio/wav' } });
    expect(JSON.parse(f.mock.calls[2][1].body)).toMatchObject({ url: `r2://priv/project-assets/${P}/abcdef.wav`, file_name: 'ref.wav', in_portal: false });
  });

  it('surfaces the server message', async () => {
    const f = vi.fn().mockResolvedValue(json({ error: 'That file type is not supported.' }, 415));
    await expect(uploadProjectAsset(P, new File(['x'], 'a.html'), { inPortal: false, fetchImpl: f })).rejects.toThrow('That file type is not supported.');
  });
});
