import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FROM_ADDRESS, DEFAULT_PRODUCER_NAME, PREVIEW_SHARE_TOKEN,
  accessNoteFor, beatSendEmailInput, playbackLabel, previewShareUrl, sharePathFor, trackCountLabel,
} from './beat-send-input';
import { buildBeatSendEmail } from './beat-send-template';

const base = {
  kind: 'tracks' as const,
  shareUrl: 'https://app.test/share/abc123',
  recipientName: 'Ada Lovelace',
  packTitle: 'Night Shift',
  trackCount: 1,
  allowDownloads: true,
  expiresAt: null,
};

describe('beatSendEmailInput', () => {
  it('defaults the producer name, from and subject', () => {
    const r = beatSendEmailInput(base);
    expect(r.producerName).toBe(DEFAULT_PRODUCER_NAME);
    expect(r.from).toBe(DEFAULT_FROM_ADDRESS);
    expect(r.subject).toBe('New music: Night Shift — U2C Beatstore');
  });

  it('uses the profile name and the configured from', () => {
    const r = beatSendEmailInput({ ...base, producerName: ' Uche ', fromAddress: 'Uche <hi@u2c.test>' });
    expect(r.subject).toBe('New music: Night Shift — Uche');
    expect(r.from).toBe('Uche <hi@u2c.test>');
    expect(r.template.producerName).toBe('Uche');
  });

  it('a typed subject wins, trimmed and capped; blank falls back', () => {
    expect(beatSendEmailInput({ ...base, subject: '  Hello  ' }).subject).toBe('Hello');
    expect(beatSendEmailInput({ ...base, subject: 'x'.repeat(300) }).subject).toHaveLength(200);
    expect(beatSendEmailInput({ ...base, subject: '   ' }).subject).toContain('Night Shift');
  });

  it('meta line carries the count and the playback option', () => {
    expect(beatSendEmailInput({ ...base, trackCount: 3, fullPlayback: true }).template.packMeta).toBe('3 tracks · Full tracks');
    expect(beatSendEmailInput({ ...base, fullPlayback: false }).template.packMeta).toBe('1 track · 75-second previews');
    expect(beatSendEmailInput(base).template.packMeta).toBe('1 track');
  });

  it('count label: unknown project count reads "project"', () => {
    expect(trackCountLabel(null, 'project')).toBe('project');
    expect(trackCountLabel(null, 'tracks')).toBe('');
    expect(trackCountLabel(0, 'project')).toBe('0 tracks');
    expect(playbackLabel(null)).toBe('');
  });

  it('access note only for commenter and editor', () => {
    expect(accessNoteFor('viewer')).toBeNull();
    expect(accessNoteFor(null)).toBeNull();
    expect(accessNoteFor('commenter')).toBe('You can leave feedback on this project.');
    expect(accessNoteFor('editor')).toBe('You can comment and edit.');
    const html = buildBeatSendEmail(beatSendEmailInput({ ...base, kind: 'project', role: 'commenter' }).template);
    expect(html).toContain('You can leave feedback on this project.');
    expect(buildBeatSendEmail(beatSendEmailInput({ ...base, kind: 'project', role: 'viewer' }).template)).not.toContain('You can');
  });

  it('a project send lists no tracks; a track send lists them', () => {
    const tracks = [{ title: 'A' }, { title: 'B' }];
    expect(beatSendEmailInput({ ...base, kind: 'project', tracks }).template.tracks).toEqual([]);
    expect(beatSendEmailInput({ ...base, tracks }).template.tracks).toEqual(tracks);
  });

  it('trims the message and falls back to a generic title', () => {
    const r = beatSendEmailInput({ ...base, packTitle: '  ', message: '  hi \n' });
    expect(r.template.message).toBe('hi');
    expect(r.template.packTitle).toBe('New music');
  });
});

describe('share URL shapes', () => {
  it('track and project paths', () => {
    expect(sharePathFor('tracks', 't')).toBe('/share/t');
    expect(sharePathFor('project', 't')).toBe('/projects/share/t');
  });
  it('the preview URL is the real shape with a placeholder token', () => {
    expect(previewShareUrl('project', 'https://app.test/')).toBe(`https://app.test/projects/share/${PREVIEW_SHARE_TOKEN}`);
    expect(previewShareUrl('tracks', 'https://app.test')).toBe(`https://app.test/share/${PREVIEW_SHARE_TOKEN}`);
  });
});
