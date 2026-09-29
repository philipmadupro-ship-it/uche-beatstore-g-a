import { describe, expect, it } from 'vitest';
import { shareCommentNotification } from './share-comment';

const base = {
  ownerId: 'owner-1',
  projectId: 'p1',
  projectName: 'New EP',
  authorName: 'Artist #1',
  body: 'Love the second beat',
  commentId: 'c1',
  shareToken: 'tok',
};

describe('shareCommentNotification', () => {
  it('addresses the project owner with who said what', () => {
    const n = shareCommentNotification({ ...base, shareLabel: 'Artist #1', trackId: 't1' });
    expect(n).toEqual({
      user_id: 'owner-1',
      kind: 'share_comment',
      title: 'Artist #1 commented on New EP',
      body: 'Love the second beat',
      data: { project_id: 'p1', comment_id: 'c1', share_token: 'tok', share_label: 'Artist #1', track_id: 't1' },
    });
  });

  it('says "replied" for a reply', () => {
    expect(shareCommentNotification({ ...base, isReply: true }).title).toBe('Artist #1 replied on New EP');
  });

  it('falls back when the project has no name', () => {
    expect(shareCommentNotification({ ...base, projectName: '  ' }).title).toBe('Artist #1 commented on a shared project');
  });

  it('flattens whitespace and truncates long comments', () => {
    const n = shareCommentNotification({ ...base, body: `line one\n\nline two ${'x'.repeat(300)}` });
    expect(n.body.startsWith('line one line two')).toBe(true);
    expect(n.body.length).toBe(140);
    expect(n.body.endsWith('…')).toBe(true);
  });
});
