import { describe, expect, it } from 'vitest';
import { DAW_EXTENSIONS, dawMismatchMessage, dawOf, sniffDaw, zipFirstEntryName } from './daw';
import { MAX_ASSET_BYTES, assetValidationMessage, guessAssetKind, validateAssetFile } from './assets';
import { alsFixture, flpFixture, rppFixture, zipFixture } from './mocks/daw-fixtures';

describe('dawOf', () => {
  it('names the app from a session extension, case-insensitively', () => {
    expect(dawOf('Night Shift.flp')).toMatchObject({ app: 'fl_studio', label: 'FL Studio project', ext: 'flp', bundle: false });
    expect(dawOf('SET.ALS')?.app).toBe('ableton');
    expect(dawOf('mix.rpp')?.app).toBe('reaper');
    expect(dawOf('a.ptx')?.app).toBe('pro_tools');
    expect(dawOf('a.cpr')?.app).toBe('cubase');
  });
  it('is null for everything else', () => {
    expect(dawOf('beat.wav')).toBeNull();
    expect(dawOf('notes.pdf')).toBeNull();
    expect(dawOf('flp')).toBeNull();
    expect(dawOf('archive.zip')).toBeNull();
  });
  it('recognises a bundled session from the zip first entry', () => {
    expect(dawOf('x.zip', zipFixture('Night Shift/Night Shift.flp'))).toMatchObject({ app: 'fl_studio', bundle: true });
    expect(dawOf('x.zip', zipFixture('My Song.logicx/Alternatives/000/ProjectData'))?.app).toBe('logic');
    expect(dawOf('x.zip', zipFixture('Song.band/projectData'))?.app).toBe('garageband');
    expect(dawOf('x.zip', zipFixture('photos/cover.png'))).toBeNull();
    expect(dawOf('x.zip', new Uint8Array(4))).toBeNull();
  });
  it('zipFirstEntryName refuses non-zips and truncated headers', () => {
    expect(zipFirstEntryName(new Uint8Array(10))).toBeNull();
    expect(zipFirstEntryName(flpFixture())).toBeNull();
    expect(zipFirstEntryName(zipFixture('a/b.flp'))).toBe('a/b.flp');
  });
});

describe('sniffDaw', () => {
  it('accepts the real signatures and refuses a renamed file', () => {
    expect(sniffDaw('flp', flpFixture())).toBe('ok');
    expect(sniffDaw('als', alsFixture())).toBe('ok');
    expect(sniffDaw('rpp', rppFixture())).toBe('ok');
    expect(sniffDaw('flp', new Uint8Array(Buffer.from('<html>'))) ).toBe('mismatch');
    expect(sniffDaw('als', flpFixture())).toBe('mismatch');
    expect(sniffDaw('rpp', alsFixture())).toBe('mismatch');
    expect(sniffDaw('flp', new Uint8Array(0))).toBe('mismatch');
  });
  it('does not guess about formats without a stable signature', () => {
    expect(sniffDaw('ptx', new Uint8Array(8))).toBe('unchecked');
    expect(sniffDaw('cpr', new Uint8Array(8))).toBe('unchecked');
  });
  it('the refusal names the app', () => {
    expect(dawMismatchMessage('flp')).toContain('FL Studio');
  });
});

describe('producer upload rules', () => {
  it('accepts the DAW extensions as octet-stream', () => {
    for (const ext of Object.keys(DAW_EXTENSIONS)) {
      expect(validateAssetFile({ name: `s.${ext}`, size: 1000 })).toEqual({ ok: true, extension: ext, mime: 'application/octet-stream' });
    }
  });
  it('still refuses scripts and unknown types, and keeps the size rules', () => {
    expect(validateAssetFile({ name: 'x.html', size: 10 })).toMatchObject({ ok: false, error: 'unsupported-type' });
    expect(validateAssetFile({ name: 'x.svg', size: 10 })).toMatchObject({ ok: false });
    expect(validateAssetFile({ name: 'x.exe', size: 10 })).toMatchObject({ ok: false });
    expect(validateAssetFile({ name: 'a.flp', size: 0 })).toMatchObject({ error: 'empty' });
    expect(validateAssetFile({ name: 'a.flp', size: MAX_ASSET_BYTES + 1 })).toMatchObject({ error: 'too-large' });
  });
  it('a session is stored as kind "other" (the DB kind check is unchanged)', () => {
    expect(guessAssetKind('Night Shift.flp')).toBe('other');
  });
  it('the unsupported message lists DAW projects', () => {
    expect(assetValidationMessage('unsupported-type')).toContain('DAW project');
  });
});
