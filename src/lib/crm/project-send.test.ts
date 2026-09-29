import { describe, expect, it } from 'vitest';
import { buildProjectSendRow } from './project-send';

describe('buildProjectSendRow', () => {
  it('builds a sent row for a direct (non-campaign) project send', () => {
    expect(buildProjectSendRow({
      contactId: 'c-1',
      trackIds: ['t-1', 't-2'],
      shareToken: 'tok',
      message: '  New EP for you  ',
      emailResendId: 'resend-1',
    })).toEqual({
      contact_id: 'c-1',
      track_ids: ['t-1', 't-2'],
      share_token: 'tok',
      message: 'New EP for you',
      status: 'sent',
      campaign_id: null,
      email_resend_id: 'resend-1',
    });
  });

  it('carries the campaign id when the send belongs to one', () => {
    expect(buildProjectSendRow({
      contactId: 'c-1',
      trackIds: [],
      shareToken: 'tok',
      campaignId: 'camp-1',
    }).campaign_id).toBe('camp-1');
  });

  it('keeps project order and drops duplicate or empty track ids', () => {
    expect(buildProjectSendRow({
      contactId: 'c-1',
      trackIds: ['t-2', 't-1', 't-2', ''],
      shareToken: 'tok',
    }).track_ids).toEqual(['t-2', 't-1']);
  });

  it('defaults a missing message to an empty string and a missing resend id to null', () => {
    const row = buildProjectSendRow({ contactId: 'c-1', trackIds: ['t-1'], shareToken: 'tok', message: null });
    expect(row.message).toBe('');
    expect(row.email_resend_id).toBeNull();
  });
});
