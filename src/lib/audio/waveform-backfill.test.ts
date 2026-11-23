import { describe, expect, it, vi } from 'vitest';
import { pickWaveBackfillRows, runWaveBackfill, type WaveBackfillRow } from './waveform-backfill';

const row = (id: string, over: Partial<WaveBackfillRow> = {}): WaveBackfillRow => ({
  id, preview_url: `https://pub.r2.dev/previews/${id}.mp3`, store_listed: false, created_at: `2026-01-0${id.length}`, ...over,
});

describe('pickWaveBackfillRows', () => {
  it('puts store-listed first, then oldest, and drops rows a file cannot sit beside', () => {
    const rows = [
      row('a', { created_at: '2026-03-01' }),
      row('b', { store_listed: true, created_at: '2026-05-01' }),
      row('c', { store_listed: true, created_at: '2026-02-01' }),
      row('d', { preview_url: null }),
      row('e', { org_id: 'org-1' }),
      row('f', { preview_url: 'r2://priv/orgs/0b7f0e0a-1111-4222-8333-444455556666/tracks/x.wav' }),
      row('g', { created_at: '2026-01-01' }),
    ];
    expect(pickWaveBackfillRows(rows).map((r) => r.id)).toEqual(['c', 'b', 'g', 'a']);
  });
});

describe('runWaveBackfill', () => {
  const rows = [row('a', { store_listed: true }), row('bb', { store_listed: true }), row('ccc'), row('dddd', { preview_url: null })];

  it('dry run by default: counts, writes nothing', async () => {
    const ensure = vi.fn(async () => 'written' as const);
    const s = await runWaveBackfill(rows, { apply: false }, { exists: async () => false, ensure });
    expect(ensure).not.toHaveBeenCalled();
    expect(s).toMatchObject({ dryRun: true, toWrite: 3, written: 0, unsupported: 1, alreadyHave: 0 });
  });

  it('skips tracks that already have the file and honours --limit on the ones that need it', async () => {
    const ensure = vi.fn(async () => 'written' as const);
    const exists = async (u: string) => u.includes('/a.');
    const s = await runWaveBackfill(rows, { apply: true, limit: 1 }, { exists, ensure });
    expect(ensure).toHaveBeenCalledTimes(1);
    expect(ensure).toHaveBeenCalledWith('https://pub.r2.dev/previews/bb.mp3');
    expect(s).toMatchObject({ alreadyHave: 1, toWrite: 1, written: 1, failed: 0, dryRun: false });
  });

  it('records failures and carries on', async () => {
    const ensure = vi.fn(async (u: string) => (u.includes('/a.') ? 'failed' : 'written') as 'written' | 'failed');
    const s = await runWaveBackfill(rows, { apply: true }, { exists: async () => false, ensure });
    expect(s).toMatchObject({ written: 2, failed: 1 });
    expect(s.failures).toEqual([{ id: 'a', preview_url: 'https://pub.r2.dev/previews/a.mp3' }]);
  });
});
