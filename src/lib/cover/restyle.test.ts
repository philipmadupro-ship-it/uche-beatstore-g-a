import { describe, expect, it } from 'vitest';
import { moodById, moods, restyleDocument } from './restyle';
import {
  addLayer, createArtworkDocument, createShapeLayer, createTextLayer, groupLayers,
} from '@/components/cover-art/cover-art-document';

const base = () => createArtworkDocument('de-roche-mineral', { kind: 'empty', label: 'Empty design' });

describe('the mood set', () => {
  it('has unique ids and every one resolves', () => {
    const ids = moods.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(moodById(id)).not.toBeNull());
  });

  it('resolves an unknown id to null rather than throwing', () => {
    expect(moodById('nope')).toBeNull();
  });

  it('gives each mood a distinct typographic position', () => {
    // Two moods that produce artwork you cannot tell apart mean one was not
    // worth offering.
    const signatures = moods.map((m) => `${m.type.font}:${m.type.weight}:${m.type.uppercase}`);
    expect(new Set(signatures).size).toBe(moods.length);
  });
});

describe('restyleDocument', () => {
  it('is a no-op for an unknown mood', () => {
    const doc = base();
    expect(restyleDocument(doc, 'nope')).toBe(doc);
  });

  it('keeps the composition entirely intact', () => {
    // The whole point: same work, different register.
    const doc = base();
    const next = restyleDocument(doc, 'brutalist');
    doc.layers.forEach((before, index) => {
      const after = next.layers[index];
      expect(after.id).toBe(before.id);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(after.rotation).toBe(before.rotation);
      if (before.type === 'text' && after.type === 'text') {
        expect(after.text).toBe(before.text);
      }
    });
  });

  it('restyles text typography', () => {
    let doc = base();
    doc = addLayer(doc, createTextLayer(doc, 'title', { fontWeight: 400, uppercase: false }));
    const layer = doc.layers.at(-1)!;
    const after = restyleDocument(doc, 'brutalist').layers.find((l) => l.id === layer.id)!;
    expect(after.type).toBe('text');
    if (after.type === 'text') {
      expect(after.fontFamily).toBe('akira');
      expect(after.uppercase).toBe(true);
      expect(after.text).toBe('title');
    }
  });

  it('SCALES tracking rather than setting it', () => {
    // A title deliberately spaced at 40 should stay relatively wide; one set
    // tight should stay relatively tight.
    let doc = base();
    doc = addLayer(doc, createTextLayer(doc, 'A', { tracking: 10 }));
    doc = addLayer(doc, createTextLayer(doc, 'B', { tracking: 40 }));
    const [a, b] = doc.layers.slice(-2);
    const next = restyleDocument(doc, 'luxury');
    const afterA = next.layers.find((l) => l.id === a.id)!;
    const afterB = next.layers.find((l) => l.id === b.id)!;
    if (afterA.type === 'text' && afterB.type === 'text') {
      expect(afterB.tracking).toBeGreaterThan(afterA.tracking);
      expect(afterA.tracking).not.toBe(10);
    }
  });

  it('merges effects so an unrelated manual setting survives', () => {
    let doc = base();
    const shape = createShapeLayer(doc, 'rect');
    doc = addLayer(doc, { ...shape, fx: { blur: 12, contrast: 3 } });
    const after = restyleDocument(doc, 'brutalist').layers.find((l) => l.id === shape.id)!;
    // Brutalist has an opinion about contrast but not blur.
    expect(after.fx?.blur).toBe(12);
    expect(after.fx?.contrast).toBe(moodById('brutalist')!.fx.contrast);
  });

  it('skips locked layers', () => {
    const doc = base();
    const locked = doc.layers.find((l) => l.locked)!;
    const after = restyleDocument(doc, 'underground').layers.find((l) => l.id === locked.id)!;
    expect(after).toEqual(locked);
  });

  it('skips groups, which hold no pixels of their own', () => {
    // Restyling the wrapper would double the effect on everything inside it.
    let doc = base();
    const a = createShapeLayer(doc, 'rect');
    doc = addLayer(doc, a);
    const { document: grouped, id } = groupLayers(doc, [a.id]);
    const after = restyleDocument(grouped, 'soft').layers.find((l) => l.id === id)!;
    expect(after.fx).toBeUndefined();
  });

  it('updates the palette and ground for a whole-document restyle', () => {
    const next = restyleDocument(base(), 'luxury');
    expect(next.palette.accent).toBe(moodById('luxury')!.palette.accent);
    expect(next.background).toBe(moodById('luxury')!.background);
  });

  it('leaves palette and ground alone for a partial restyle', () => {
    // Restyling a selection is a question about those layers, not the cover.
    const doc = base();
    const target = doc.layers.find((l) => !l.locked)!;
    const next = restyleDocument(doc, 'luxury', [target.id]);
    expect(next.palette).toEqual(doc.palette);
    expect(next.background).toBe(doc.background);
  });

  it('touches only the named layers in a partial restyle', () => {
    const doc = base();
    const [target, other] = doc.layers.filter((l) => !l.locked);
    const next = restyleDocument(doc, 'underground', [target.id]);
    expect(next.layers.find((l) => l.id === other.id)).toEqual(other);
    expect(next.layers.find((l) => l.id === target.id)).not.toEqual(target);
  });

  it('does not mutate the input', () => {
    const doc = base();
    const before = JSON.stringify(doc);
    restyleDocument(doc, 'brutalist');
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('produces a renderable document for every mood', () => {
    for (const mood of moods) {
      const next = restyleDocument(base(), mood.id);
      expect(next.layers).toHaveLength(base().layers.length);
      next.layers.forEach((l) => expect(Number.isFinite(l.x)).toBe(true));
    }
  });
});
