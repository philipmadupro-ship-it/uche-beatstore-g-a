import { describe, expect, it } from 'vitest';
import { connectedStatus, consentSentence, consentStateLabel, myConsentStatus, unreachableSentence } from './store-consent-copy';

describe('the words of the consent step', () => {
  it('names each state plainly', () => {
    expect(consentStateLabel('proposed')).toBe('Asked');
    expect(consentStateLabel('yes')).toBe('Agreed');
    expect(consentStateLabel('no')).toBe('Said no');
  });

  it('says what a status means for the release', () => {
    expect(consentSentence('refused')).toMatch(/stays off the store until they say yes/);
    expect(consentSentence('waiting')).toMatch(/no takes it off at once/);
    expect(consentSentence('agreed')).toMatch(/agreed/);
    expect(consentSentence('none')).toBe('');
  });

  it('tells the lister who could not be told, and never invents a way to reach them', () => {
    expect(unreachableSentence({ asked: 2, notified: 2, unreachable: 0 })).toBe('2 artists were asked.');
    const s = unreachableSentence({ asked: 3, notified: 1, unreachable: 2 });
    expect(s).toMatch(/2 have no account in this organization, so nobody could be told/);
    expect(s).not.toMatch(/email/i);
    expect(unreachableSentence({ asked: 1, notified: 0, unreachable: 1 })).toMatch(/^1 artist was asked\. 1 has no account/);
  });

  it('describes the artist’s and the store owner’s rows', () => {
    expect(myConsentStatus('no', false)).toBe('off the store, until you say yes');
    expect(myConsentStatus('proposed', true)).toBe('on the store, waiting for your answer');
    expect(connectedStatus({ listed: true, vetoed: true, refused: false, serving: false })).toBe('taken off by you');
    expect(connectedStatus({ listed: true, vetoed: false, refused: true, serving: false })).toBe('an artist said no');
    expect(connectedStatus({ listed: true, vetoed: false, refused: false, serving: true })).toBe('on your store');
    expect(connectedStatus({ listed: true, vetoed: false, refused: false, serving: false })).toBe('listed, not out yet');
  });
});
