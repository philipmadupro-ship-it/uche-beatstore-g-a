// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionContext } from './useSessionContext';

const reset = () =>
  useSessionContext.setState({
    bpm: null,
    key: null,
    scale: null,
    matchTolerance: 2,
    previewInSession: false,
  });

describe('useSessionContext', () => {
  beforeEach(reset);

  it('clamps a tempo into range', () => {
    useSessionContext.getState().setBpm(140.4);
    expect(useSessionContext.getState().bpm).toBe(140);
    useSessionContext.getState().setBpm(9999);
    expect(useSessionContext.getState().bpm).toBe(300);
  });

  it('keeps the mode when only the tonic changes', () => {
    // Picking a different key off the keyboard must not quietly discard
    // "minor" — the producer chose it once.
    useSessionContext.getState().setKey('F', 'minor');
    useSessionContext.getState().setKey('G');
    expect(useSessionContext.getState()).toMatchObject({ key: 'G', scale: 'minor' });
  });

  it('clears the mode when asked to explicitly', () => {
    useSessionContext.getState().setKey('F', 'minor');
    useSessionContext.getState().setKey('G', null);
    expect(useSessionContext.getState().scale).toBe(null);
  });

  it('swaps to the relative major or minor', () => {
    useSessionContext.getState().setKey('F', 'minor');
    useSessionContext.getState().makeRelative();
    expect(useSessionContext.getState()).toMatchObject({ key: 'G#', scale: 'major' });
  });

  it('does nothing relative without both a tonic and a mode', () => {
    useSessionContext.getState().setKey('F', null);
    useSessionContext.getState().makeRelative();
    expect(useSessionContext.getState()).toMatchObject({ key: 'F', scale: null });
  });

  it('halves and doubles the tempo', () => {
    useSessionContext.getState().setBpm(140);
    useSessionContext.getState().scaleTempo(0.5);
    expect(useSessionContext.getState().bpm).toBe(70);
    useSessionContext.getState().scaleTempo(2);
    expect(useSessionContext.getState().bpm).toBe(140);
  });

  it('will not halve a tempo that was never set', () => {
    useSessionContext.getState().scaleTempo(0.5);
    expect(useSessionContext.getState().bpm).toBe(null);
  });

  it('clears the session but keeps how the producer likes matching to behave', () => {
    useSessionContext.getState().setBpm(140);
    useSessionContext.getState().setKey('F', 'minor');
    useSessionContext.getState().setMatchTolerance(6);
    useSessionContext.getState().setPreviewInSession(true);

    useSessionContext.getState().clear();

    expect(useSessionContext.getState()).toMatchObject({
      bpm: null,
      key: null,
      scale: null,
      // Preferences, not session state.
      matchTolerance: 6,
      previewInSession: true,
    });
  });

  it('never accepts a negative tolerance', () => {
    useSessionContext.getState().setMatchTolerance(-5);
    expect(useSessionContext.getState().matchTolerance).toBe(0);
  });
});
