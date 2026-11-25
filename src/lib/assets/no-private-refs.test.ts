import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assetsOfProject, assetsOfTrack } from './index';

/** lib/assets may READ a reference to classify and fingerprint it; it must never emit one. */
describe('lib/assets never outputs a private reference', () => {
  it('no output field carries r2://, local:// or a signed URL', () => {
    const rows = [
      ...assetsOfTrack(
        { id: 't', title: 'T', audio_url: 'r2://priv/secret/key.wav', wav_url: 'local://project-assets/x.wav' },
        { vocals: 'r2://priv/stem.wav' },
      ),
      ...assetsOfProject([
        { id: 'd', project_id: 'p', kind: 'other', label: 'S', file_name: 's.flp', mime: 'application/octet-stream', size_bytes: 1, position: 0, in_portal: false, portal_at: null, created_at: 'x', downloadUrl: '/api/projects/p/assets/d/download' },
        { id: 'a', project_id: 'p', kind: 'audio', label: 'L', file_name: 'f.wav', mime: 'audio/wav', size_bytes: 1, position: 0, in_portal: false, portal_at: null, created_at: 'x', downloadUrl: '/api/projects/p/assets/a/download' },
      ]),
    ];
    const json = JSON.stringify(rows);
    expect(json).not.toMatch(/r2:\/\/|local:\/\/|X-Amz-|Signature=|secret\/key/);
  });

  it('source files do not build a presigned URL or import storage/server code', () => {
    const dir = __dirname;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.ts') && !n.endsWith('.test.ts'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/presign|getSignedUrl|@aws-sdk|createServiceClient|server-only/);
    }
  });
});
