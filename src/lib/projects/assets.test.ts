import { describe, expect, it } from 'vitest';
import {
  assetAvailableAt,
  assetDownloadName,
  assetObjectKey,
  defaultAssetLabel,
  fileExtension,
  formatBytes,
  guessAssetKind,
  MAX_ASSET_BYTES,
  projectAssetKeyOf,
  validateAssetFile,
} from './assets';

const P = '6f1c1b2e-8c1f-4c43-9f0a-0a4b3c2d1e0f';
const OTHER = '11111111-2222-4333-8444-555555555555';

describe('validateAssetFile', () => {
  it('accepts listed types and stores the allowlisted MIME', () => {
    expect(validateAssetFile({ name: 'Lyrics v2.PDF', size: 10 })).toEqual({ ok: true, extension: 'pdf', mime: 'application/pdf' });
    expect(validateAssetFile({ name: 'ref.wav', size: 10 })).toMatchObject({ ok: true, mime: 'audio/wav' });
  });
  it('refuses scriptable and unknown types', () => {
    for (const name of ['page.html', 'logo.svg', 'x.js', 'noext', '.env']) {
      expect(validateAssetFile({ name, size: 10 })).toEqual({ ok: false, error: 'unsupported-type' });
    }
  });
  it('refuses empty and oversized files', () => {
    expect(validateAssetFile({ name: 'a.pdf', size: 0 })).toEqual({ ok: false, error: 'empty' });
    expect(validateAssetFile({ name: 'a.pdf', size: MAX_ASSET_BYTES + 1 })).toEqual({ ok: false, error: 'too-large' });
  });
});

describe('guessAssetKind / defaultAssetLabel', () => {
  it('reads the name before the type', () => {
    expect(guessAssetKind('MIDNIGHT lyrics.docx')).toBe('lyrics');
    expect(guessAssetKind('drake_ref.mp3')).toBe('reference');
    expect(guessAssetKind('Reference - vibe.wav')).toBe('reference');
    expect(guessAssetKind('cover.png')).toBe('artwork');
    expect(guessAssetKind('bounce.wav')).toBe('audio');
    expect(guessAssetKind('split sheet.pdf')).toBe('document');
    expect(guessAssetKind('session.zip')).toBe('other');
  });
  it('labels a file by its name without the extension', () => {
    expect(defaultAssetLabel('C:\\fakepath\\Split sheet.pdf')).toBe('Split sheet');
    expect(defaultAssetLabel('README')).toBe('README');
    expect(fileExtension('.bashrc')).toBe('');
  });
});

describe('storage references', () => {
  it('builds a key inside the project folder', () => {
    expect(assetObjectKey(P, 'abc123XYZ_', 'pdf')).toBe(`project-assets/${P}/abc123XYZ_.pdf`);
    expect(() => assetObjectKey('../../tracks', 'abc123', 'pdf')).toThrow();
    expect(() => assetObjectKey(P, '../x', 'pdf')).toThrow();
  });
  it('trusts only a reference to this project, in an allowed bucket', () => {
    const key = `project-assets/${P}/abc123XYZ_.pdf`;
    expect(projectAssetKeyOf(`r2://priv/${key}`, P, ['priv'])).toBe(key);
    expect(projectAssetKeyOf(`local://${key}`, P, [])).toBe(key);
    expect(projectAssetKeyOf(`r2://public/${key}`, P, ['priv'])).toBeNull();
    expect(projectAssetKeyOf(`r2://priv/project-assets/${OTHER}/abc123XYZ_.pdf`, P, ['priv'])).toBeNull();
    expect(projectAssetKeyOf('r2://priv/tracks/master.wav', P, ['priv'])).toBeNull();
    expect(projectAssetKeyOf(`r2://priv/project-assets/${P}/../tracks/x.wav`, P, ['priv'])).toBeNull();
    expect(projectAssetKeyOf('https://evil.test/x.pdf', P, ['priv'])).toBeNull();
  });
});

describe('formatting', () => {
  it('formats sizes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
    expect(formatBytes(null)).toBe('');
  });
  it('names downloads safely, keeping the extension', () => {
    expect(assetDownloadName('Split sheet', 'x.pdf')).toBe('Split sheet.pdf');
    expect(assetDownloadName('a/b"c\r\n', 'x.pdf')).toBe('a b c.pdf');
    expect(assetDownloadName('', 'Lyrics.txt')).toBe('Lyrics.txt');
  });
});

describe('assetAvailableAt', () => {
  it('is the later of going into the portal and the project being shared', () => {
    expect(assetAvailableAt({ portal_at: '2026-09-10T00:00:00Z', created_at: '2026-09-01T00:00:00Z' }, '2026-09-05T00:00:00Z')).toBe('2026-09-10T00:00:00Z');
    expect(assetAvailableAt({ portal_at: null, created_at: '2026-09-01T00:00:00Z' }, '2026-09-05T00:00:00Z')).toBe('2026-09-05T00:00:00Z');
  });
});
