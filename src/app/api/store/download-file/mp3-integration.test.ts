/**
 * End to end through the REAL route, the real deliverable code and real ffmpeg:
 * a lease that includes only MP3, bought on a track whose master is a WAV on
 * disk, receives a genuine MP3 — and the WAV itself is still refused.
 * Only the database is stubbed. Skipped without ffmpeg.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ isSupabaseConfigured: () => true }));

const MASTER = '/uploads/__mp3-deliverable-test__.wav';
const masterPath = path.join(process.cwd(), 'public', MASTER);
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

function sineWav(seconds: number): Buffer {
  const rate = 44100;
  const frames = rate * seconds;
  const data = Buffer.alloc(frames * 4);
  for (let i = 0; i < frames; i++) {
    const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000);
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const auditRows: Array<Record<string, unknown>> = [];
vi.mock('@/lib/auth/ownership', () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      if (table === 'store_events') return { insert: (r: Record<string, unknown>) => { auditRows.push(r); return Promise.resolve({ error: null }); } };
      if (table === 'license_purchases') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: {
                  id: 'purchase-1', seller_user_id: 'seller-1', download_unlocked: true, needs_refund_review: false,
                  license_type: 'lease', track_ids: ['track-1'],
                  line_items: [{ track_id: 'track-1', license_id: 'basic', license_type: 'lease', file_types: ['MP3'], stems_included: false, is_exclusive: false }],
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'tracks') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { title: 'Night Shift', audio_url: MASTER, wav_url: null }, error: null }) }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  }),
}));

const url = (format: string) => `http://localhost/api/store/download-file?session_id=cs_test&track_id=track-1&format=${format}`;

describe.skipIf(!hasFfmpeg)('lease on a WAV master (real route, real ffmpeg)', () => {
  beforeAll(() => { fs.writeFileSync(masterPath, sineWav(2)); });
  afterAll(() => { fs.rmSync(masterPath, { force: true }); });

  it('delivers a real MP3 named for the track, and refuses the WAV', async () => {
    const { GET } = await import('./route');

    const res = await GET(new NextRequest(url('mp3')));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(res.headers.get('content-disposition')).toContain('Night Shift.mp3');

    const body = Buffer.from(await res.arrayBuffer());
    const isMp3 = body.subarray(0, 3).toString() === 'ID3' || (body[0] === 0xff && (body[1] & 0xe0) === 0xe0);
    expect(isMp3).toBe(true);
    // The WAV master is ~352 kB; the MP3 is the whole 2 s at 320 kbps (~80 kB).
    expect(body.length).toBeGreaterThan(70_000);
    expect(body.length).toBeLessThan(fs.statSync(masterPath).size);
    // It is not the master: no RIFF header.
    expect(body.subarray(0, 4).toString()).not.toBe('RIFF');

    expect(auditRows.at(-1)?.metadata).toMatchObject({ format: 'mp3', outcome: 'granted' });

    const wav = await GET(new NextRequest(url('wav')));
    expect(wav.status).toBe(403);
  });
});
