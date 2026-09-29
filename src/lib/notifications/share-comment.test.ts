import { describe, expect, it } from 'vitest';
import {
  SHARE_COMMENT_EXCERPT_CHARS,
  buildShareCommentNotification,
  formatCommentTime,
} from './share-comment';

const base = {
  ownerId: 'owner-1',
  commentId: 'comment-1',
  projectId: 'project-1',
  projectName: 'New EP',
  authorName: 'Artist #1',
  body: 'Love the bounce on this one',
};

describe('buildShareCommentNotification', () => {
  it('names the author and the project, and quotes the comment', () => {
    const row = buildShareCommentNotification(base);
    expect(row).toMatchObject({
      user_id: 'owner-1',
      kind: 'share_comment',
      title: 'Artist #1 commented on New EP',
      body: 'Love the bounce on this one',
    });
    expect(row.data).toMatchObject({ dedupe_key: 'share_comment_comment-1', comment_id: 'comment-1', project_id: 'project-1' });
  });

  it('says replied for a threaded comment', () => {
    expect(buildShareCommentNotification({ ...base, parentId: 'c-0' }).title).toBe('Artist #1 replied on New EP');
  });

  it('puts the track and the pinned region in front of the text', () => {
    const row = buildShareCommentNotification({
      ...base,
      trackId: 't-1',
      trackTitle: 'MIDNIGHT',
      regionStart: 42.4,
      regionEnd: 58.9,
    });
    expect(row.body).toBe('“MIDNIGHT” · 0:42–0:58 · Love the bounce on this one');
    expect(row.data).toMatchObject({ track_id: 't-1', region_start: 42.4, region_end: 58.9 });
  });

  it('ignores a region that is missing a side or runs backwards', () => {
    expect(buildShareCommentNotification({ ...base, regionStart: 10, regionEnd: null }).data.region_start).toBeNull();
    expect(buildShareCommentNotification({ ...base, regionStart: 30, regionEnd: 10 }).body).toBe(base.body);
  });

  it('shortens a long comment and flattens its whitespace', () => {
    const long = `line one\n\n${'x'.repeat(400)}`;
    const body = buildShareCommentNotification({ ...base, body: long }).body;
    expect(body.length).toBe(SHARE_COMMENT_EXCERPT_CHARS);
    expect(body.startsWith('line one x')).toBe(true);
    expect(body.endsWith('…')).toBe(true);
  });

  it('falls back when the project name or author is blank', () => {
    expect(buildShareCommentNotification({ ...base, projectName: null, authorName: '  ' }).title)
      .toBe('Someone commented on a shared project');
  });

  it('never carries a share token', () => {
    const row = buildShareCommentNotification(base);
    expect(JSON.stringify(row)).not.toMatch(/token/i);
  });
});

describe('formatCommentTime', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatCommentTime(0)).toBe('0:00');
    expect(formatCommentTime(9.9)).toBe('0:09');
    expect(formatCommentTime(125)).toBe('2:05');
  });

  it('reads nonsense as zero', () => {
    expect(formatCommentTime(-3)).toBe('0:00');
    expect(formatCommentTime(Number.NaN)).toBe('0:00');
  });
});
