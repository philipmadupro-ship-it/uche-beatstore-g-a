import { describe, expect, it } from 'vitest';
import { buildPortalCommentNotification, formatTimecode, pinAt, threadComments, toPortalComment, type CommentRow } from './comments';

const names = { artistName: 'Artist #1', producerName: 'UCHE' };
const row = (over: Partial<CommentRow>): CommentRow => ({
  id: 'c', project_id: 'p1', track_id: null, user_id: null, parent_id: null, author_name: 'typed name',
  body: 'hi', region_start: null, region_end: null, created_at: '2026-09-29T10:00:00Z', ...over,
});

describe('toPortalComment', () => {
  it('names the side, never exposes the user id', () => {
    const artist = toPortalComment(row({ author_name: 'Somebody Else' }), names);
    const producer = toPortalComment(row({ user_id: 'owner-uuid' }), names);
    expect(artist).toMatchObject({ fromProducer: false, authorName: 'Artist #1' });
    expect(producer).toMatchObject({ fromProducer: true, authorName: 'UCHE' });
    expect(JSON.stringify(producer)).not.toContain('owner-uuid');
  });
  it('keeps a valid pin and drops a broken one', () => {
    expect(toPortalComment(row({ region_start: '12.5', region_end: '17.5' }), names)).toMatchObject({ regionStart: 12.5, regionEnd: 17.5 });
    expect(toPortalComment(row({ region_start: 20, region_end: 10 }), names)).toMatchObject({ regionStart: null, regionEnd: null });
  });
});

describe('threadComments', () => {
  it('groups replies (and replies to replies) under their root, oldest first', () => {
    const cs = [
      row({ id: 'r2', parent_id: 'r1', created_at: '2026-09-29T12:00:00Z' }),
      row({ id: 'a', created_at: '2026-09-29T10:00:00Z' }),
      row({ id: 'r1', parent_id: 'a', created_at: '2026-09-29T11:00:00Z', user_id: 'o' }),
      row({ id: 'b', created_at: '2026-09-29T09:00:00Z' }),
      row({ id: 'orphan', parent_id: 'gone', created_at: '2026-09-29T13:00:00Z' }),
    ].map((r) => toPortalComment(r, names));
    const threads = threadComments(cs);
    expect(threads.map((t) => t.root.id)).toEqual(['b', 'a', 'orphan']);
    expect(threads[1].replies.map((r) => r.id)).toEqual(['r1', 'r2']);
  });
});

describe('pins and timecodes', () => {
  it('pins 5 seconds from the playhead, clipped to the track', () => {
    expect(pinAt(0.5, 120)).toEqual({ region_start: 60, region_end: 65 });
    expect(pinAt(0.99, 100)).toEqual({ region_start: 99, region_end: 100 });
    expect(pinAt(0, 100)).toBeNull();
    expect(pinAt(0.5, null)).toBeNull();
  });
  it('formats', () => {
    expect(formatTimecode(83.9)).toBe('1:23');
    expect(formatTimecode(null)).toBe('0:00');
  });
});

describe('buildPortalCommentNotification', () => {
  it('says who, where and when, and truncates', () => {
    const n = buildPortalCommentNotification({
      ownerId: 'o', contactId: 'c1', contactName: 'Artist #1', commentId: 'x', projectId: 'p1', projectName: 'New EP',
      trackId: 't1', trackTitle: 'MIDNIGHT', body: 'a'.repeat(300), isReply: false, regionStart: 83,
    });
    expect(n.kind).toBe('portal_comment');
    expect(n.title).toBe('Artist #1 commented on MIDNIGHT at 1:23');
    expect(n.body.length).toBe(140);
    expect(n.data).toEqual({ contact_id: 'c1', comment_id: 'x', project_id: 'p1', track_id: 't1' });
  });
});
