import { describe, expect, it } from 'vitest';
import {
  audioMimeTypeForExtension,
  buildTrackDownloadUrl,
  canDragTrackOutOfApp,
  extensionFromAudioUrl,
  formatDownloadUrlData,
  sanitizeDownloadFilename,
} from './dnd';

describe('sanitizeDownloadFilename', () => {
  it('appends the given extension to a plain title', () => {
    expect(sanitizeDownloadFilename('Night Shift', 'mp3')).toBe('Night Shift.mp3');
  });

  it('strips path separators so the name cannot escape a directory', () => {
    expect(sanitizeDownloadFilename('../../etc/passwd', 'wav')).toBe('etc passwd.wav');
    expect(sanitizeDownloadFilename('drums/kick\\snare', 'wav')).toBe('drums kick snare.wav');
  });

  it('strips control characters', () => {
    expect(sanitizeDownloadFilename('Cold\u0000Front\u001f', 'wav')).toBe('Cold Front.wav');
  });

  it('strips leading dots so the file is never hidden', () => {
    expect(sanitizeDownloadFilename('...secret', 'mp3')).toBe('secret.mp3');
  });

  it('trims trailing dots and spaces (Windows silently drops them)', () => {
    expect(sanitizeDownloadFilename('Cold Front...   ', 'mp3')).toBe('Cold Front.mp3');
  });

  it('never produces an empty name', () => {
    expect(sanitizeDownloadFilename('', 'mp3')).toBe('track.mp3');
    expect(sanitizeDownloadFilename('...', 'mp3')).toBe('track.mp3');
    expect(sanitizeDownloadFilename('///', 'mp3')).toBe('track.mp3');
  });

  it('renames a bare Windows-reserved device name', () => {
    expect(sanitizeDownloadFilename('CON', 'wav')).toBe('CON_.wav');
    expect(sanitizeDownloadFilename('con', 'wav')).toBe('con_.wav');
    expect(sanitizeDownloadFilename('NUL', 'mp3')).toBe('NUL_.mp3');
    expect(sanitizeDownloadFilename('COM1', 'mp3')).toBe('COM1_.mp3');
  });

  it('does not rename a title that merely starts with a reserved word', () => {
    expect(sanitizeDownloadFilename('Constellation', 'mp3')).toBe('Constellation.mp3');
  });

  it('falls back to mp3 when the extension is missing or unrecognisable', () => {
    expect(sanitizeDownloadFilename('Night Shift', '')).toBe('Night Shift.mp3');
  });

  it('normalises a leading dot and mixed-case extension', () => {
    expect(sanitizeDownloadFilename('Night Shift', '.WAV')).toBe('Night Shift.wav');
  });

  it('strips characters that are illegal in a Windows filename', () => {
    expect(sanitizeDownloadFilename('Song: Reprise? <2>', 'mp3')).toBe('Song Reprise 2.mp3');
  });

  it('caps extremely long titles', () => {
    const long = 'x'.repeat(300);
    const result = sanitizeDownloadFilename(long, 'mp3');
    expect(result.length).toBeLessThanOrEqual(154); // 150 + '.mp3'
    expect(result.endsWith('.mp3')).toBe(true);
  });
});

describe('extensionFromAudioUrl', () => {
  it('reads the extension off a plain URL', () => {
    expect(extensionFromAudioUrl('https://cdn.example.com/tracks/night-shift.wav')).toBe('wav');
  });

  it('reads the extension off an opaque r2:// reference', () => {
    expect(extensionFromAudioUrl('r2://my-bucket/uploads/abc123/night-shift.mp3')).toBe('mp3');
  });

  it('ignores a query string', () => {
    expect(extensionFromAudioUrl('https://cdn.example.com/a.wav?token=abc')).toBe('wav');
  });

  it('falls back to mp3 when there is no extension', () => {
    expect(extensionFromAudioUrl('https://cdn.example.com/tracks/night-shift')).toBe('mp3');
    expect(extensionFromAudioUrl('')).toBe('mp3');
  });
});

describe('audioMimeTypeForExtension', () => {
  it('maps known extensions', () => {
    expect(audioMimeTypeForExtension('wav')).toBe('audio/wav');
    expect(audioMimeTypeForExtension('MP3')).toBe('audio/mpeg');
  });

  it('falls back to audio/mpeg for unknown extensions', () => {
    expect(audioMimeTypeForExtension('xyz')).toBe('audio/mpeg');
  });
});

describe('canDragTrackOutOfApp', () => {
  it('is true when the track has a non-empty audio_url', () => {
    expect(canDragTrackOutOfApp({ audio_url: 'r2://bucket/key.wav' })).toBe(true);
  });

  it('is false when audio_url is missing, empty, or blank', () => {
    expect(canDragTrackOutOfApp({})).toBe(false);
    expect(canDragTrackOutOfApp({ audio_url: null })).toBe(false);
    expect(canDragTrackOutOfApp({ audio_url: '' })).toBe(false);
    expect(canDragTrackOutOfApp({ audio_url: '   ' })).toBe(false);
  });
});

describe('buildTrackDownloadUrl', () => {
  it('routes through the authenticated /api/audio proxy, never a raw source', () => {
    const url = buildTrackDownloadUrl(
      'https://uche-beatstore-g.vercel.app',
      'r2://private-bucket/uploads/abc/night-shift.wav',
      'Night Shift.wav',
    );
    expect(url.startsWith('https://uche-beatstore-g.vercel.app/api/audio?')).toBe(true);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('src')).toBe('r2://private-bucket/uploads/abc/night-shift.wav');
    expect(parsed.searchParams.get('download')).toBe('1');
    expect(parsed.searchParams.get('filename')).toBe('Night Shift.wav');
  });

  it('strips a trailing slash on the origin', () => {
    const url = buildTrackDownloadUrl('https://example.com/', 'r2://b/k.mp3', 'k.mp3');
    expect(url.startsWith('https://example.com/api/audio?')).toBe(true);
  });
});

describe('formatDownloadUrlData', () => {
  it('joins mime, filename and url with colons per the DownloadURL spec', () => {
    expect(formatDownloadUrlData('audio/wav', 'Night Shift.wav', 'https://example.com/api/audio?src=x')).toBe(
      'audio/wav:Night Shift.wav:https://example.com/api/audio?src=x',
    );
  });

  it('strips stray colons from mime and filename so only the url segment keeps them', () => {
    expect(formatDownloadUrlData('audio/wav', 'Weird:Name.wav', 'https://example.com/x')).toBe(
      'audio/wav:WeirdName.wav:https://example.com/x',
    );
  });
});
