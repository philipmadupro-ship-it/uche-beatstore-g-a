import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LABEL-72: a project member who may listen but not download triggers an ffmpeg cut of the WHOLE master on first
 * listen (`ensureFullDerivative`, up to 240 s). Without a raised `maxDuration` the platform default kills the
 * request mid-cut, every retry restarts it, and the member never hears the recording. The store route that makes
 * the same copy already sets 300.
 */
describe('org audio route duration', () => {
  it('sets maxDuration high enough for the first-listen derivative cut', () => {
    const src = fs.readFileSync(path.join(__dirname, 'route.ts'), 'utf8');
    const m = /export const maxDuration = (\d+);/.exec(src);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(250);
  });
});
