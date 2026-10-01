import { describe, expect, it } from 'vitest';
import { cleanPitchNote, orderForAudience, portalAudience, PORTAL_SHAPES, stemsRequestBody } from './audience';

describe('portal audience', () => {
  it('follows the main role; anything else is the artist portal', () => {
    expect(portalAudience('Producer')).toBe('producer');
    expect(portalAudience('A&R')).toBe('label');
    expect(portalAudience('Label')).toBe('label');
    expect(portalAudience('Artist')).toBe('artist');
    expect(portalAudience('Buyer')).toBe('artist');
    expect(portalAudience(null)).toBe('artist');
  });

  it('orders by the audience, keeping project order within a type', () => {
    const tracks = [
      { id: 'b1', type: 'beat' }, { id: 'l1', type: 'loop' }, { id: 's1', type: 'song' },
      { id: 't1', type: 'topline' }, { id: 'b2', type: 'beat' }, { id: 'l2', type: 'loop' },
    ];
    expect(orderForAudience(tracks, 'artist').map((t) => t.id)).toEqual(['b1', 'b2', 's1', 't1', 'l1', 'l2']);
    expect(orderForAudience(tracks, 'producer').map((t) => t.id)).toEqual(['l1', 'l2', 'b1', 'b2', 't1', 's1']);
    expect(orderForAudience(tracks, 'label').map((t) => t.id)).toEqual(['t1', 's1', 'b1', 'b2', 'l1', 'l2']);
  });

  it('only a producer portal asks for stems; a label portal talks in packs', () => {
    expect(PORTAL_SHAPES.producer.askForStems).toBe(true);
    expect(PORTAL_SHAPES.artist.askForStems).toBe(false);
    expect(PORTAL_SHAPES.label.projectNoun.many).toBe('Packs');
    expect(stemsRequestBody('KEYS 140')).toBe('Could I get the stems for “KEYS 140”?');
  });

  it('cleans a pitch note', () => {
    expect(cleanPitchNote('  two toplines  ')).toBe('two toplines');
    expect(cleanPitchNote('   ')).toBeNull();
    expect(cleanPitchNote(42)).toBeNull();
    expect(cleanPitchNote('x'.repeat(2100))).toHaveLength(2000);
  });
});
