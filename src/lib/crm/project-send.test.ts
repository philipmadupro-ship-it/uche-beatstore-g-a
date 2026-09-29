import { describe, expect, it } from 'vitest';
import { buildProjectSendRow } from './project-send';

describe('buildProjectSendRow', () => {
  it('records a direct (non-campaign) project send', () => {
    expect(buildProjectSendRow({
      contactId: 'c1',
      trackIds: ['t1', 't2'],
      shareToken: 'tok',
      message: 'New EP ideas',
      emailResendId: 're_1',
    })).toEqual({
      contact_id: 'c1',
      track_ids: ['t1', 't2'],
      share_token: 'tok',
      message: 'New EP ideas',
      status: 'sent',
      campaign_id: null,
      email_resend_id: 're_1',
    });
  });

  it('keeps the campaign id when there is one', () => {
    expect(buildProjectSendRow({ contactId: 'c1', trackIds: [], shareToken: 'tok', campaignId: 'k1' }).campaign_id).toBe('k1');
  });

  it('dedupes track ids and defaults the message to empty', () => {
    const row = buildProjectSendRow({ contactId: 'c1', trackIds: ['t1', 't1', 't2'], shareToken: 'tok', message: null });
    expect(row.track_ids).toEqual(['t1', 't2']);
    expect(row.message).toBe('');
    expect(row.email_resend_id).toBeNull();
  });
});
