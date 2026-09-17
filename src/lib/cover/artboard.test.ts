import { describe, expect, it } from 'vitest';
import {
  addLayer, createArtworkDocument, createShapeLayer, createTextLayer,
  type ArtworkDocument,
} from '@/components/cover-art/cover-art-document';
import {
  ARTBOARD_MAX, ARTBOARD_MIN, artboardPresets, aspectLabel, clampArtboardSize,
  matchArtboardPreset, resizeArtboard, scaleFx,
} from './artboard';

const base = (): ArtworkDocument =>
  createArtworkDocument('de-roche-mineral', { kind: 'empty', label: 'Empty design' });

describe('presets', () => {
  it('has unique ids', () => {
    const ids = artboardPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps every preset inside the accepted range', () => {
    for (const preset of artboardPresets) {
      expect(preset.width).toBeGreaterThanOrEqual(ARTBOARD_MIN);
      expect(preset.height).toBeGreaterThanOrEqual(ARTBOARD_MIN);
      expect(preset.width).toBeLessThanOrEqual(ARTBOARD_MAX);
      expect(preset.height).toBeLessThanOrEqual(ARTBOARD_MAX);
    }
  });

  it('leads with the 3000px square, which is the streaming master', () => {
    expect(artboardPresets[0]).toMatchObject({ width: 3000, height: 3000 });
  });

  it('offers the ratios the brief asks for', () => {
    const ratios = artboardPresets.map((preset) => aspectLabel(preset.width, preset.height));
    expect(ratios).toContain('1:1');
    expect(ratios).toContain('4:5');
    expect(ratios).toContain('9:16');
    expect(ratios).toContain('16:9');
  });

  it('matches a document size back to its preset', () => {
    expect(matchArtboardPreset(3000, 3000)?.id).toBe('square-3000');
    expect(matchArtboardPreset(1234, 4321)).toBeNull();
  });
});

describe('clampArtboardSize', () => {
  it('clamps to the accepted range', () => {
    expect(clampArtboardSize(10)).toBe(ARTBOARD_MIN);
    expect(clampArtboardSize(99999)).toBe(ARTBOARD_MAX);
  });

  it('rounds to whole units', () => {
    expect(clampArtboardSize(1080.6)).toBe(1081);
  });

  it('survives junk rather than producing NaN dimensions', () => {
    expect(clampArtboardSize(Number.NaN)).toBe(ARTBOARD_MIN);
    expect(clampArtboardSize(Infinity)).toBe(ARTBOARD_MAX);
  });
});

describe('aspectLabel', () => {
  it('reduces to the simplest whole-number ratio', () => {
    expect(aspectLabel(3000, 3000)).toBe('1:1');
    expect(aspectLabel(2160, 2700)).toBe('4:5');
    expect(aspectLabel(2560, 1440)).toBe('16:9');
    expect(aspectLabel(1620, 2880)).toBe('9:16');
  });

  it('does not divide by zero', () => {
    expect(() => aspectLabel(0, 0)).not.toThrow();
  });
});

describe('resizeArtboard', () => {
  it('returns the same document when nothing changes', () => {
    const doc = base();
    expect(resizeArtboard(doc, doc.width, doc.height)).toBe(doc);
  });

  it('changes the canvas and leaves layers alone in keep mode', () => {
    const doc = base();
    const next = resizeArtboard(doc, 1500, 1500, 'keep');
    expect(next.width).toBe(1500);
    expect(next.layers).toEqual(doc.layers);
  });

  it('scales layers by the fitting factor', () => {
    const doc = base();
    const next = resizeArtboard(doc, 1500, 1500, 'scale');
    const before = doc.layers.find((layer) => layer.name === 'Main Title')!;
    const after = next.layers.find((layer) => layer.id === before.id)!;
    expect(after.width).toBe(Math.round(before.width / 2));
    expect(after.height).toBe(Math.round(before.height / 2));
  });

  it('keeps a centred layer centred', () => {
    let doc = base();
    const layer = createShapeLayer(doc, 'rect', {
      x: 1000, y: 1000, width: 1000, height: 1000,
    });
    doc = addLayer(doc, layer);
    const next = resizeArtboard(doc, 1500, 1500, 'scale');
    const after = next.layers.find((item) => item.id === layer.id)!;
    // Centred at 1500,1500 on a 3000 board → centred at 750,750 on a 1500 one.
    expect(after.x + after.width / 2).toBeCloseTo(750, 0);
    expect(after.y + after.height / 2).toBeCloseTo(750, 0);
  });

  it('fits rather than crops when the aspect changes', () => {
    const doc = base();
    // 3000x3000 → 2560x1440. The limiting axis is height: 1440/3000 = 0.48.
    const next = resizeArtboard(doc, 2560, 1440, 'scale');
    const before = doc.layers.find((layer) => layer.name === 'Main Title')!;
    const after = next.layers.find((layer) => layer.id === before.id)!;
    expect(after.width).toBe(Math.round(before.width * (1440 / 3000)));
  });

  it('scales type size and tracking, not just the frame', () => {
    let doc = base();
    const layer = createTextLayer(doc, 'TITLE', { fontSize: 200, tracking: 20 });
    doc = addLayer(doc, layer);
    const after = resizeArtboard(doc, 1500, 1500, 'scale')
      .layers.find((item) => item.id === layer.id)!;
    expect(after.type).toBe('text');
    if (after.type === 'text') {
      expect(after.fontSize).toBe(100);
      expect(after.tracking).toBe(10);
    }
  });

  it('scales effect lengths, which are in document units', () => {
    // The bug this guards: a 24-unit blur reads as a soft haze on a 3000px
    // board and as a smear on a 1080px one. Halving the board must halve it.
    let doc = base();
    const layer = createShapeLayer(doc, 'rect');
    doc = addLayer(doc, {
      ...layer,
      fx: {
        blur: 24,
        chromatic: 8,
        shadow: { x: 20, y: 40, blur: 60, color: '#000', opacity: 0.5 },
        glow: { blur: 30, color: '#fff', opacity: 0.5 },
      },
    });
    const after = resizeArtboard(doc, 1500, 1500, 'scale')
      .layers.find((item) => item.id === layer.id)!;
    expect(after.fx?.blur).toBe(12);
    expect(after.fx?.chromatic).toBe(4);
    expect(after.fx?.shadow).toMatchObject({ x: 10, y: 20, blur: 30 });
    expect(after.fx?.glow).toMatchObject({ blur: 15 });
  });

  it('clamps an out-of-range request instead of producing a broken board', () => {
    const next = resizeArtboard(base(), 99999, 5, 'scale');
    expect(next.width).toBe(ARTBOARD_MAX);
    expect(next.height).toBe(ARTBOARD_MIN);
  });

  it('never produces NaN geometry', () => {
    const next = resizeArtboard(base(), 1080, 1920, 'scale');
    for (const layer of next.layers) {
      expect(Number.isFinite(layer.x)).toBe(true);
      expect(Number.isFinite(layer.y)).toBe(true);
      expect(Number.isFinite(layer.width)).toBe(true);
      expect(Number.isFinite(layer.height)).toBe(true);
    }
  });

  it('round-trips back to the original size closely', () => {
    const doc = base();
    const there = resizeArtboard(doc, 1500, 1500, 'scale');
    const back = resizeArtboard(there, 3000, 3000, 'scale');
    const before = doc.layers.find((layer) => layer.name === 'Main Title')!;
    const after = back.layers.find((layer) => layer.id === before.id)!;
    // Rounding to whole units each way means this is close, not exact.
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(2);
  });
});

describe('scaleFx', () => {
  it('leaves an unset effect object alone', () => {
    expect(scaleFx(undefined, 2)).toBeUndefined();
  });

  it('does not touch unitless values', () => {
    const fx = {
      brightness: 1.2, contrast: 0.8, saturation: 1.5, hue: 30,
      grain: 0.4, vignette: 0.6, posterize: 6,
      gradientMap: { from: '#000', to: '#fff', amount: 0.5 },
    };
    expect(scaleFx(fx, 4)).toEqual(fx);
  });
});
