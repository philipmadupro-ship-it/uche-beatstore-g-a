import { describe, it, expect } from 'vitest';
import { toStemJobView, stemPlaybackUrl, clientStatusOf } from './view';

describe('stem job view', () => {
  it('never hands a private r2 reference to the browser', () => {
    const v = toStemJobView({
      id: 's', track_id: 't', job_id: 'demucs:1', status: 'done',
      vocals_url: 'r2://priv/tracks/v.wav', drums_url: 'r2://priv/tracks/d.wav', bass_url: 'r2://priv/tracks/b.wav', other_url: 'r2://priv/tracks/o.wav',
    });
    expect(v.status).toBe('ready');
    expect(JSON.stringify(v)).not.toContain('r2://');
    expect(v.stems?.vocals).toBe('/api/audio?src=' + encodeURIComponent('r2://priv/tracks/v.wav'));
  });
  it('maps statuses and words a failure', () => {
    expect(clientStatusOf('pending')).toBe('queued');
    expect(clientStatusOf(null)).toBe('none');
    expect(toStemJobView(null).status).toBe('none');
    const f = toStemJobView({ id: 's', track_id: 't', job_id: null, status: 'failed', last_error: 'boom', attempts: 3 });
    expect(f).toMatchObject({ status: 'failed', error: 'boom', attempts: 3, stems: null });
    expect(toStemJobView({ id: 's', track_id: 't', job_id: null, status: 'failed' }).error).toMatch(/Retry/);
    expect(stemPlaybackUrl(null)).toBeNull();
  });
});
