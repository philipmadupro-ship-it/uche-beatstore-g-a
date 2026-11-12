import { describe, expect, it } from 'vitest';
import { safeEntryTitle, shareZipName, zipEntryNames } from './zip-names';

describe('zipEntryNames', () => {
  it('numbers entries in order, so equal titles never collide', () => {
    expect(zipEntryNames([
      { title: 'Untitled', audio_url: 'r2://p/a.wav' },
      { title: 'Untitled', audio_url: 'r2://p/b.mp3' },
    ])).toEqual(['01 Untitled.wav', '02 Untitled.mp3']);
  });

  it('pads to the list size and defaults the extension to mp3', () => {
    const names = zipEntryNames(Array.from({ length: 120 }, () => ({ title: 'x', audio_url: 'https://cdn/x?sig=1' })));
    expect(names[0]).toBe('001 x.mp3');
    expect(names[119]).toBe('120 x.mp3');
  });

  it('cannot be turned into a path', () => {
    const [name] = zipEntryNames([{ title: '../../etc/passwd', audio_url: null }]);
    expect(name).not.toMatch(/[\\/]/);
    expect(name).not.toContain('..');
    expect(safeEntryTitle('a\u0000b\nc')).toBe('a b c');
    expect(safeEntryTitle('   ')).toBe('track');
  });
});

describe('shareZipName', () => {
  it('is a safe file name', () => {
    expect(shareZipName('Beat Tape: Vol. 3 / "final"')).toBe('Beat Tape Vol. 3 final.zip');
    expect(shareZipName(null)).toBe('share.zip');
  });
});
