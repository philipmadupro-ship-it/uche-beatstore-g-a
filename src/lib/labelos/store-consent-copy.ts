/**
 * The words of the consent step (LABEL-71), pure so the card, the page and
 * their tests say the same thing. Nothing here decides anything.
 */
import type { ConsentState, ConsentSummary } from './store-consent';

export function consentStateLabel(state: ConsentState): string {
  return state === 'yes' ? 'Agreed' : state === 'no' ? 'Said no' : 'Asked';
}

export function consentSentence(status: ConsentSummary['status']): string {
  switch (status) {
    case 'agreed':
      return 'Every credited artist agreed to this release being on the store.';
    case 'waiting':
      return 'Credited artists have been asked. The release can stay on the store while they decide; an artist’s no takes it off at once.';
    case 'refused':
      return 'An artist said no. The release stays off the store until they say yes.';
    default:
      return '';
  }
}

/** What listing did about the artists: how many were asked, and how many could not be told. */
export function unreachableSentence(a: { asked: number; notified: number; unreachable: number }): string {
  const base = a.asked === 1 ? '1 artist was asked.' : `${a.asked} artists were asked.`;
  if (a.unreachable === 0) return base;
  const who = a.unreachable === 1 ? '1 has' : `${a.unreachable} have`;
  return `${base} ${who} no account in this organization, so nobody could be told. Their answer cannot be recorded until they have one; they can still be asked directly.`;
}

/** One line for an artist's own row: where their answer leaves the release. */
export function myConsentStatus(state: ConsentState, listed: boolean): string {
  if (state === 'no') return listed ? 'you said no' : 'off the store, until you say yes';
  if (state === 'yes') return listed ? 'on the store, with your yes' : 'you said yes';
  return listed ? 'on the store, waiting for your answer' : 'waiting for your answer';
}

/** One line for the store owner's row: why it is, or is not, on their store. */
export function connectedStatus(r: { listed: boolean; vetoed: boolean; refused: boolean; serving: boolean }): string {
  if (r.vetoed) return 'taken off by you';
  if (r.refused) return 'an artist said no';
  if (r.serving) return 'on your store';
  return r.listed ? 'listed, not out yet' : 'not on the store';
}
