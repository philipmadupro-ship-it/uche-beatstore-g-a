import { describe, expect, it } from 'vitest';
import {
  EXPORT_MAX, EXPORT_MIN, clampExportSize, describeExport, exportFilename, exportFormats,
  extensionFor, fitExportSize, mimeTypeFor, resolveExport, safeFilenameBase,
  supportsQuality, supportsTransparency, type ExportSettings,
} from './export-settings';

const base: ExportSettings = {
  width: 3000,
  height: 3000,
  format: 'png',
  quality: 0.9,
  transparent: false,
  filename: 'Midnight Cartel',
};

describe('format capabilities', () => {
  it('offers quality only for lossy formats', () => {
    expect(supportsQuality('jpeg')).toBe(true);
    expect(supportsQuality('webp')).toBe(true);
    expect(supportsQuality('png')).toBe(false);
    expect(supportsQuality('svg')).toBe(false);
  });

  it('offers transparency only where there is an alpha channel', () => {
    expect(supportsTransparency('png')).toBe(true);
    expect(supportsTransparency('webp')).toBe(true);
    expect(supportsTransparency('svg')).toBe(true);
    expect(supportsTransparency('jpeg')).toBe(false);
  });

  it('maps each format to the mime type canvas expects', () => {
    expect(mimeTypeFor('png')).toBe('image/png');
    expect(mimeTypeFor('jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('webp')).toBe('image/webp');
    expect(mimeTypeFor('svg')).toBe('image/svg+xml');
  });

  it('uses the conventional jpg extension rather than jpeg', () => {
    expect(extensionFor('jpeg')).toBe('jpg');
    expect(extensionFor('png')).toBe('png');
  });

  it('lists every format exactly once in the picker data', () => {
    const ids = exportFormats.map((format) => format.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['png', 'jpeg', 'webp', 'svg']);
  });
});

describe('safeFilenameBase', () => {
  it('slugifies a display name', () => {
    expect(safeFilenameBase('Midnight Cartel')).toBe('midnight-cartel');
  });

  it('strips characters that would break a filename', () => {
    expect(safeFilenameBase('a/b\\c:d*e?f')).toBe('a-b-c-d-e-f');
  });

  it('never lets a path separator survive', () => {
    expect(safeFilenameBase('../../etc/passwd')).not.toContain('/');
    expect(safeFilenameBase('../../etc/passwd')).not.toContain('..');
  });

  it('falls back rather than producing a dotfile', () => {
    expect(safeFilenameBase('')).toBe('cover-art');
    expect(safeFilenameBase('!!!')).toBe('cover-art');
    expect(safeFilenameBase('   ')).toBe('cover-art');
  });

  it('trims leading and trailing separators', () => {
    expect(safeFilenameBase('---hello---')).toBe('hello');
  });

  it('caps absurd lengths', () => {
    expect(safeFilenameBase('x'.repeat(500)).length).toBeLessThanOrEqual(80);
  });
});

describe('exportFilename', () => {
  it('appends the right extension', () => {
    expect(exportFilename({ filename: 'Midnight Cartel', format: 'jpeg' })).toBe('midnight-cartel.jpg');
    expect(exportFilename({ filename: 'Midnight Cartel', format: 'png' })).toBe('midnight-cartel.png');
    expect(exportFilename({ filename: 'Midnight Cartel', format: 'svg' })).toBe('midnight-cartel.svg');
  });
});

describe('clampExportSize', () => {
  it('clamps to the accepted range', () => {
    expect(clampExportSize(1)).toBe(EXPORT_MIN);
    expect(clampExportSize(99999)).toBe(EXPORT_MAX);
    expect(clampExportSize(Infinity)).toBe(EXPORT_MAX);
  });

  it('treats NaN as the minimum rather than producing a broken canvas', () => {
    expect(clampExportSize(Number.NaN)).toBe(EXPORT_MIN);
  });
});

describe('resolveExport', () => {
  it('passes a valid request through unchanged', () => {
    const resolved = resolveExport({ ...base, format: 'webp', quality: 0.8, transparent: true });
    expect(resolved).toMatchObject({
      width: 3000, height: 3000, format: 'webp', mimeType: 'image/webp',
      quality: 0.8, transparent: true,
    });
    expect(resolved.notes).toEqual([]);
  });

  it('drops transparency for JPG and SAYS so', () => {
    // The failure this prevents: asking a canvas for a transparent JPEG gives
    // you a black background, and nobody finds out until the artwork is
    // already uploaded somewhere.
    const resolved = resolveExport({ ...base, format: 'jpeg', transparent: true });
    expect(resolved.transparent).toBe(false);
    expect(resolved.notes).toHaveLength(1);
    expect(resolved.notes[0]).toMatch(/transparen/i);
  });

  it('pins quality to 1 for formats where it does nothing', () => {
    expect(resolveExport({ ...base, format: 'png', quality: 0.3 }).quality).toBe(1);
  });

  it('keeps quality for formats where it matters', () => {
    expect(resolveExport({ ...base, format: 'jpeg', quality: 0.55 }).quality).toBe(0.55);
  });

  it('clamps quality into a range canvas accepts', () => {
    expect(resolveExport({ ...base, format: 'jpeg', quality: 5 }).quality).toBe(1);
    expect(resolveExport({ ...base, format: 'jpeg', quality: -2 }).quality).toBe(0.1);
  });

  it('clamps dimensions', () => {
    const resolved = resolveExport({ ...base, width: 0, height: 999999 });
    expect(resolved.width).toBe(EXPORT_MIN);
    expect(resolved.height).toBe(EXPORT_MAX);
  });

  it('produces the filename with the resolved extension', () => {
    expect(resolveExport({ ...base, format: 'jpeg' }).filename).toBe('midnight-cartel.jpg');
  });

  it('never reports a transparency it will not deliver', () => {
    for (const format of ['png', 'jpeg', 'webp', 'svg'] as const) {
      const resolved = resolveExport({ ...base, format, transparent: true });
      expect(resolved.transparent).toBe(supportsTransparency(format));
    }
  });
});

describe('describeExport', () => {
  it('summarises size and format', () => {
    expect(describeExport(resolveExport({ ...base, width: 1400, height: 1400 })))
      .toBe('1400×1400 · PNG');
  });

  it('mentions quality only where it applies', () => {
    expect(describeExport(resolveExport({ ...base, format: 'jpeg', quality: 0.8 })))
      .toContain('80% quality');
    expect(describeExport(resolveExport({ ...base, format: 'png' })))
      .not.toContain('quality');
  });

  it('mentions transparency only when it will actually happen', () => {
    expect(describeExport(resolveExport({ ...base, format: 'png', transparent: true })))
      .toContain('transparent');
    expect(describeExport(resolveExport({ ...base, format: 'jpeg', transparent: true })))
      .not.toContain('transparent');
  });
});

describe('fitExportSize', () => {
  it('keeps a square square', () => {
    expect(fitExportSize(3000, 3000, 1400)).toEqual({ width: 1400, height: 1400 });
  });

  it('preserves a portrait ratio', () => {
    // 9:16 board at a 1600 long edge → 900x1600.
    expect(fitExportSize(1620, 2880, 1600)).toEqual({ width: 900, height: 1600 });
  });

  it('preserves a landscape ratio', () => {
    expect(fitExportSize(2560, 1440, 1280)).toEqual({ width: 1280, height: 720 });
  });

  it('never returns a zero dimension', () => {
    const { width, height } = fitExportSize(3000, 3000, 1);
    expect(width).toBeGreaterThanOrEqual(EXPORT_MIN);
    expect(height).toBeGreaterThanOrEqual(EXPORT_MIN);
  });
});
