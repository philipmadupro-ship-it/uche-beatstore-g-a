import { describe, expect, it } from 'vitest';
import {
  DECISIONS,
  canArtistSetDecision,
  decisionFromLegacySendStatus,
  describeDecisionChange,
  isDecision,
} from './decisions';

describe('decision vocabulary', () => {
  it('is the six agreed words, in pipeline order', () => {
    expect(DECISIONS).toEqual(['interested', 'selected', 'recording', 'recorded', 'released', 'passed']);
  });

  it('recognises only those words', () => {
    expect(isDecision('recording')).toBe(true);
    expect(isDecision('negotiating')).toBe(false);
    expect(isDecision(null)).toBe(false);
  });
});

describe('canArtistSetDecision', () => {
  it('lets the artist say interested or pass, or take it back', () => {
    expect(canArtistSetDecision(null, 'interested')).toBe(true);
    expect(canArtistSetDecision('interested', 'passed')).toBe(true);
    expect(canArtistSetDecision('passed', null)).toBe(true);
  });

  it('never lets the artist set a working decision', () => {
    expect(canArtistSetDecision(null, 'selected')).toBe(false);
    expect(canArtistSetDecision('interested', 'released')).toBe(false);
  });

  it('does not let a portal tap undo what the producer moved along', () => {
    expect(canArtistSetDecision('recording', 'passed')).toBe(false);
    expect(canArtistSetDecision('selected', null)).toBe(false);
  });
});

describe('decisionFromLegacySendStatus (mirrors migration 123)', () => {
  it('maps the old per-send statuses', () => {
    expect(decisionFromLegacySendStatus('interested')).toBe('interested');
    expect(decisionFromLegacySendStatus('negotiating')).toBe('selected');
    expect(decisionFromLegacySendStatus('placed')).toBe('released');
    expect(decisionFromLegacySendStatus('pass')).toBe('passed');
  });

  it('treats engagement statuses as no decision', () => {
    expect(decisionFromLegacySendStatus('sent')).toBeNull();
    expect(decisionFromLegacySendStatus('opened')).toBeNull();
    expect(decisionFromLegacySendStatus(null)).toBeNull();
  });
});

describe('describeDecisionChange', () => {
  it('names the artist for their own reactions and "You" for the producer', () => {
    expect(describeDecisionChange({ contactName: 'Artist #1', trackTitle: 'MIDNIGHT', decision: 'interested', setBy: 'artist' }))
      .toBe('Artist #1 marked MIDNIGHT Interested');
    expect(describeDecisionChange({ contactName: 'Artist #1', trackTitle: 'MIDNIGHT', decision: 'recording', setBy: 'producer' }))
      .toBe('You marked MIDNIGHT Recording');
    expect(describeDecisionChange({ contactName: 'Artist #1', trackTitle: 'MIDNIGHT', decision: 'passed', setBy: 'artist' }))
      .toBe('Artist #1 passed on MIDNIGHT');
    expect(describeDecisionChange({ contactName: 'Artist #1', trackTitle: 'MIDNIGHT', decision: null, setBy: 'artist' }))
      .toBe('Artist #1 took back their reaction to MIDNIGHT');
  });
});
