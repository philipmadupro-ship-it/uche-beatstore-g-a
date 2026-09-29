import { describe, expect, it } from 'vitest';
import { defaultStoreLayout } from './layout';
import { layoutSaveProblem } from './layout-save';

const sent = defaultStoreLayout();

describe('layoutSaveProblem', () => {
  it('accepts a response that stored the same arrangement', () => {
    // jsonb reorders keys; only section order and ids have to match.
    const stored = JSON.parse(JSON.stringify({ theme: sent.theme, sections: sent.sections, version: sent.version }));
    expect(layoutSaveProblem(sent, { profile: { store_layout: stored } })).toBeNull();
  });

  it('flags a 200 whose row has no layout (the dropped-field bug)', () => {
    expect(layoutSaveProblem(sent, { profile: { store_layout: null } })).toMatch(/did not store/);
    expect(layoutSaveProblem(sent, { profile: {} })).toMatch(/did not store/);
  });

  it('flags a row holding a different arrangement', () => {
    const reordered = { ...sent, sections: [...sent.sections].reverse() };
    expect(layoutSaveProblem(sent, { profile: { store_layout: reordered } })).toMatch(/did not store/);
  });

  it('does not guess when the server returned no profile', () => {
    expect(layoutSaveProblem(sent, {})).toBeNull();
    expect(layoutSaveProblem(sent, null)).toBeNull();
  });
});
