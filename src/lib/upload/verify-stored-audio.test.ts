import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockHead = vi.fn();
const mockDelete = vi.fn();
vi.mock('@/lib/storage/upload', () => ({
  readStoredObjectHead: (...a: unknown[]) => mockHead(...a),
  deleteStoredObject: (...a: unknown[]) => mockDelete(...a),
}));
vi.mock('@/lib/upload/processing', async () => {
  // Use the real sniffer without loading the processing job's dependencies.
  const wavHead = (b: Buffer) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WAVE';
  return { sniffAudioBuffer: (b: Buffer) => (wavHead(b) ? { ok: true, format: 'wav' } : { ok: false, format: 'unknown' }) };
});

import { verifyStoredAudio } from './verify-stored-audio';

beforeEach(() => { vi.clearAllMocks(); mockDelete.mockResolvedValue(undefined); });

describe('verifyStoredAudio', () => {
  it('accepts a real audio header and keeps the object', async () => {
    mockHead.mockResolvedValue(Buffer.from('RIFF\0\0\0\0WAVEfmt '));
    expect(await verifyStoredAudio('r2://priv/a.wav')).toEqual({ ok: true });
    expect(mockHead).toHaveBeenCalledWith('r2://priv/a.wav', 16);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('rejects non-audio bytes and deletes the object', async () => {
    mockHead.mockResolvedValue(Buffer.from('<html><script>x'));
    expect(await verifyStoredAudio('r2://priv/a.wav')).toEqual({ ok: false, format: 'unknown' });
    expect(mockDelete).toHaveBeenCalledWith('r2://priv/a.wav');
  });

  it('passes sources it cannot inspect (local dev)', async () => {
    mockHead.mockResolvedValue(null);
    expect(await verifyStoredAudio('/uploads/a.wav')).toEqual({ ok: true });
  });
});
