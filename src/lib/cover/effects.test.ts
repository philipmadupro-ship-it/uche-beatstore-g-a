import { describe, expect, it } from 'vitest';
import {
  buildFxFilterDef,
  channelOf,
  fxDefaults,
  fxPresetById,
  fxPresets,
  fxFilterRef,
  hasAnyFx,
  hasFilterFx,
  hasPaintedFx,
  neutralFx,
  vignetteCssGradient,
  vignetteStops,
  vignetteSvgGradientDef,
  type ArtworkLayerFx,
} from './effects';

/** Standard filter inputs a primitive may reference without declaring them. */
const BUILT_IN_INPUTS = new Set([
  'SourceGraphic',
  'SourceAlpha',
  'BackgroundImage',
  'BackgroundAlpha',
  'FillPaint',
  'StrokePaint',
]);

/**
 * Every `in`/`in2` must name either a built-in source or a `result` declared
 * earlier in the chain. A primitive that references a name nothing produced is
 * not an error the browser reports — it silently renders as transparent black,
 * so the layer just vanishes. This is the check that catches a mis-threaded
 * chain before a producer discovers it by exporting a blank cover.
 */
function assertChainIsThreaded(markup: string) {
  const declared = new Set<string>();
  // Walk primitives in document order so "declared earlier" is meaningful.
  const primitivePattern = /<fe[A-Za-z]+[^>]*?\/?>/g;
  const matches = markup.match(primitivePattern) ?? [];
  for (const primitive of matches) {
    for (const attribute of ['in', 'in2']) {
      const found = new RegExp(`\\s${attribute}="([^"]+)"`).exec(primitive);
      if (!found) continue;
      const reference = found[1];
      if (BUILT_IN_INPUTS.has(reference)) continue;
      expect(
        declared.has(reference),
        `primitive ${primitive} references "${reference}" before anything produced it`,
      ).toBe(true);
    }
    const result = /\sresult="([^"]+)"/.exec(primitive);
    if (result) declared.add(result[1]);
  }
  return matches.length;
}

/** Catches the duplicate-attribute class of bug that made exports unloadable. */
function assertNoDuplicateAttributes(markup: string) {
  const tags = markup.match(/<[a-zA-Z][^>]*>/g) ?? [];
  for (const tag of tags) {
    const names = [...tag.matchAll(/\s([a-zA-Z-]+)="/g)].map((m) => m[1]);
    const unique = new Set(names);
    expect(unique.size, `duplicate attribute in ${tag}`).toBe(names.length);
  }
}

describe('fxDefaults', () => {
  it('treats undefined as fully neutral', () => {
    expect(fxDefaults(undefined)).toEqual(neutralFx);
  });

  it('treats an empty object as fully neutral', () => {
    expect(fxDefaults({})).toEqual(neutralFx);
  });

  it('keeps explicit zero values rather than falling back to the default', () => {
    // `?? ` not `|| ` — brightness 0 is a legitimate value (black) and must not
    // silently become 1.
    expect(fxDefaults({ brightness: 0 }).brightness).toBe(0);
    expect(fxDefaults({ saturation: 0 }).saturation).toBe(0);
  });

  it('drops a gradient map, shadow or glow whose amount/opacity is zero', () => {
    expect(fxDefaults({ gradientMap: { from: '#000', to: '#fff', amount: 0 } }).gradientMap).toBeNull();
    expect(fxDefaults({ shadow: { x: 4, y: 4, blur: 8, color: '#000', opacity: 0 } }).shadow).toBeNull();
    expect(fxDefaults({ glow: { blur: 8, color: '#fff', opacity: 0 } }).glow).toBeNull();
  });
});

describe('hasFilterFx / hasPaintedFx', () => {
  it('is false for an unset or neutral fx', () => {
    expect(hasFilterFx(undefined)).toBe(false);
    expect(hasFilterFx({})).toBe(false);
    expect(hasFilterFx({ brightness: 1, contrast: 1, saturation: 1 })).toBe(false);
  });

  it.each<[string, ArtworkLayerFx]>([
    ['exposure', { exposure: 0.5 }],
    ['brightness', { brightness: 1.2 }],
    ['contrast', { contrast: 0.8 }],
    ['saturation', { saturation: 0 }],
    ['hue', { hue: 45 }],
    ['blur', { blur: 4 }],
    ['sharpen', { sharpen: 0.5 }],
    ['grain', { grain: 0.3 }],
    ['chromatic', { chromatic: 3 }],
    ['posterize', { posterize: 4 }],
    ['gradientMap', { gradientMap: { from: '#000', to: '#fff', amount: 1 } }],
    ['shadow', { shadow: { x: 2, y: 2, blur: 4, color: '#000', opacity: 0.5 } }],
    ['glow', { glow: { blur: 10, color: '#fff', opacity: 0.4 } }],
  ])('is true when %s is set', (_name, fx) => {
    expect(hasFilterFx(fx)).toBe(true);
  });

  it('does not treat vignette as a filter, because it is painted', () => {
    expect(hasFilterFx({ vignette: 0.6 })).toBe(false);
    expect(hasPaintedFx({ vignette: 0.6 })).toBe(true);
    expect(hasAnyFx({ vignette: 0.6 })).toBe(true);
  });

  it('ignores a posterize of 1 or 0, which would be meaningless', () => {
    expect(hasFilterFx({ posterize: 0 })).toBe(false);
    expect(hasFilterFx({ posterize: 1 })).toBe(false);
    expect(hasFilterFx({ posterize: 2 })).toBe(true);
  });
});

describe('channelOf', () => {
  it('reads each channel of a six-digit hex', () => {
    expect(channelOf('#ff0000', 0)).toBe(1);
    expect(channelOf('#ff0000', 1)).toBe(0);
    expect(channelOf('#0000ff', 2)).toBe(1);
  });

  it('expands three-digit shorthand', () => {
    expect(channelOf('#f00', 0)).toBe(1);
    expect(channelOf('#fff', 1)).toBe(1);
  });

  it('tolerates a missing hash', () => {
    expect(channelOf('00ff00', 1)).toBe(1);
  });

  it('returns 0 rather than NaN for junk, so the SVG stays numeric', () => {
    expect(channelOf('not-a-colour', 0)).toBe(0);
  });
});

describe('buildFxFilterDef', () => {
  it('returns an empty string when the layer needs no filter', () => {
    expect(buildFxFilterDef(undefined, 'fx-1', 1, 100)).toBe('');
    expect(buildFxFilterDef({}, 'fx-1', 1, 100)).toBe('');
    expect(buildFxFilterDef({ vignette: 0.5 }, 'fx-1', 1, 100)).toBe('');
  });

  it('uses the id it is given', () => {
    const def = buildFxFilterDef({ blur: 3 }, 'fx-canvas-abc', 1, 100);
    expect(def).toContain('id="fx-canvas-abc"');
  });

  it('collapses exposure, brightness and contrast into one transfer', () => {
    const def = buildFxFilterDef({ exposure: 1, brightness: 2, contrast: 1 }, 'f', 1, 100);
    const transfers = def.match(/<feComponentTransfer/g) ?? [];
    expect(transfers).toHaveLength(1);
    // 2^1 * 2 * 1 = 4
    expect(def).toContain('slope="4"');
  });

  it('derives the contrast intercept so mid-grey is the pivot', () => {
    const def = buildFxFilterDef({ contrast: 2 }, 'f', 1, 100);
    // intercept = 0.5 - 0.5 * 2 = -0.5
    expect(def).toContain('intercept="-0.5"');
  });

  it('emits a posterize table with one entry per step', () => {
    const def = buildFxFilterDef({ posterize: 4 }, 'f', 1, 100);
    const table = /<feFuncR type="discrete" tableValues="([^"]+)"/.exec(def);
    expect(table).not.toBeNull();
    expect(table![1].split(' ')).toHaveLength(4);
    expect(table![1]).toBe('0 0.3333 0.6667 1');
  });

  it('skips the cross-fade composite when a gradient map is at full strength', () => {
    const full = buildFxFilterDef(
      { gradientMap: { from: '#000000', to: '#ffffff', amount: 1 } }, 'f', 1, 100,
    );
    const partial = buildFxFilterDef(
      { gradientMap: { from: '#000000', to: '#ffffff', amount: 0.5 } }, 'f', 1, 100,
    );
    expect(full).not.toContain('feComposite');
    expect(partial).toContain('feComposite');
    expect(partial).toContain('k2="0.5"');
    expect(partial).toContain('k3="0.5"');
  });

  it('maps gradient-map endpoints onto the transfer tables', () => {
    const def = buildFxFilterDef(
      { gradientMap: { from: '#ff0000', to: '#0000ff', amount: 1 } }, 'f', 1, 100,
    );
    // red → blue: R ramps 1→0, B ramps 0→1
    expect(def).toContain('<feFuncR type="table" tableValues="1 0" />');
    expect(def).toContain('<feFuncB type="table" tableValues="0 1" />');
  });
});

describe('scale — the canvas/export unit bridge', () => {
  it('multiplies blur by the scale factor', () => {
    expect(buildFxFilterDef({ blur: 10 }, 'f', 1, 100)).toContain('stdDeviation="10"');
    expect(buildFxFilterDef({ blur: 10 }, 'f', 0.5, 100)).toContain('stdDeviation="5"');
    expect(buildFxFilterDef({ blur: 10 }, 'f', 2, 100)).toContain('stdDeviation="20"');
  });

  it('multiplies shadow offset and blur by the scale factor', () => {
    const def = buildFxFilterDef(
      { shadow: { x: 10, y: -6, blur: 4, color: '#000', opacity: 0.5 } }, 'f', 0.5, 100,
    );
    expect(def).toContain('dx="5"');
    expect(def).toContain('dy="-3"');
    expect(def).toContain('stdDeviation="2"');
  });

  it('multiplies chromatic separation by the scale factor', () => {
    const def = buildFxFilterDef({ chromatic: 8 }, 'f', 0.25, 100);
    expect(def).toContain('dx="-2"');
    expect(def).toContain('dx="2"');
  });

  it('DIVIDES grain frequency by the scale, because frequency is a reciprocal', () => {
    // The failure this guards: multiplying here makes grain coarsen as you zoom
    // in, so the export comes back finer than the canvas the producer approved.
    const atOne = /baseFrequency="([\d.]+)"/.exec(buildFxFilterDef({ grain: 0.5 }, 'f', 1, 100))!;
    const atHalf = /baseFrequency="([\d.]+)"/.exec(buildFxFilterDef({ grain: 0.5 }, 'f', 0.5, 100))!;
    expect(Number(atHalf[1])).toBeGreaterThan(Number(atOne[1]));
    expect(Number(atHalf[1])).toBeCloseTo(Number(atOne[1]) * 2, 4);
  });

  it('leaves unitless values alone regardless of scale', () => {
    const a = buildFxFilterDef({ saturation: 0.5, hue: 30 }, 'f', 1, 100);
    const b = buildFxFilterDef({ saturation: 0.5, hue: 30 }, 'f', 4, 100);
    expect(a.replace('id="f"', '')).toBe(b.replace('id="f"', ''));
  });
});

describe('filter region', () => {
  it('uses a modest default pad when nothing spills', () => {
    const def = buildFxFilterDef({ contrast: 1.4 }, 'f', 1, 100);
    expect(def).toContain('x="-10%"');
    expect(def).toContain('width="120%"');
  });

  it('grows the region so a large blur is not clipped to a hard rectangle', () => {
    const def = buildFxFilterDef({ blur: 40 }, 'f', 1, 100);
    const pad = Number(/x="-(\d+)%"/.exec(def)![1]);
    expect(pad).toBeGreaterThan(10);
  });

  it('accounts for shadow offset as well as its blur', () => {
    const near = buildFxFilterDef(
      { shadow: { x: 2, y: 2, blur: 2, color: '#000', opacity: 1 } }, 'f', 1, 100,
    );
    const far = buildFxFilterDef(
      { shadow: { x: 90, y: 90, blur: 2, color: '#000', opacity: 1 } }, 'f', 1, 100,
    );
    const padOf = (svg: string) => Number(/x="-(\d+)%"/.exec(svg)![1]);
    expect(padOf(far)).toBeGreaterThan(padOf(near));
  });

  it('caps the region so a huge blur on a tiny layer stays renderable', () => {
    const def = buildFxFilterDef({ blur: 5000 }, 'f', 1, 10);
    expect(Number(/x="-(\d+)%"/.exec(def)![1])).toBeLessThanOrEqual(200);
  });
});

describe('filter markup integrity', () => {
  const everything: ArtworkLayerFx = {
    exposure: 0.4,
    brightness: 1.1,
    contrast: 1.3,
    saturation: 0.7,
    hue: 24,
    blur: 3,
    sharpen: 0.4,
    grain: 0.35,
    chromatic: 5,
    posterize: 6,
    gradientMap: { from: '#0C0C0A', to: '#C8A47A', amount: 0.7 },
    shadow: { x: 6, y: 8, blur: 12, color: '#000000', opacity: 0.6 },
    glow: { blur: 18, color: '#F2F2F0', opacity: 0.5 },
  };

  it('threads every primitive input to something that exists', () => {
    const count = assertChainIsThreaded(buildFxFilterDef(everything, 'f', 1, 400));
    expect(count).toBeGreaterThan(10);
  });

  it('threads correctly for every single effect in isolation', () => {
    const keys = Object.keys(everything) as (keyof ArtworkLayerFx)[];
    for (const key of keys) {
      const single = { [key]: everything[key] } as ArtworkLayerFx;
      const def = buildFxFilterDef(single, 'f', 1, 400);
      assertChainIsThreaded(def);
    }
  });

  it('threads correctly for every adjacent pair, catching order-dependent breaks', () => {
    const keys = Object.keys(everything) as (keyof ArtworkLayerFx)[];
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const pair = { [keys[i]]: everything[keys[i]], [keys[j]]: everything[keys[j]] } as ArtworkLayerFx;
        assertChainIsThreaded(buildFxFilterDef(pair, 'f', 1, 400));
      }
    }
  });

  it('never repeats an attribute on a tag', () => {
    assertNoDuplicateAttributes(buildFxFilterDef(everything, 'f', 1, 400));
  });

  it('balances every tag it opens', () => {
    const def = buildFxFilterDef(everything, 'f', 1, 400);
    const opens = (def.match(/<(?!\/)[a-zA-Z]/g) ?? []).length;
    const selfClosing = (def.match(/\/>/g) ?? []).length;
    const closes = (def.match(/<\//g) ?? []).length;
    expect(opens).toBe(selfClosing + closes);
  });

  it('quotes every attribute value', () => {
    const def = buildFxFilterDef(everything, 'f', 1, 400);
    expect(def).not.toMatch(/=[^"]/);
  });

  it('emits no NaN or undefined into the markup', () => {
    const def = buildFxFilterDef(everything, 'f', 1, 400);
    expect(def).not.toContain('NaN');
    expect(def).not.toContain('undefined');
  });

  it('renders in sRGB so canvas and export agree on colour maths', () => {
    // The SVG default is linearRGB, which browsers apply to CSS `filter: url()`
    // too — but every hand-written CSS approximation in the studio is sRGB, so
    // pinning this keeps the two consistent and the numbers predictable.
    expect(buildFxFilterDef({ blur: 2 }, 'f', 1, 100)).toContain('color-interpolation-filters="sRGB"');
  });
});

describe('fxFilterRef', () => {
  it('returns a url() reference only when there is a filter to point at', () => {
    expect(fxFilterRef({ blur: 2 }, 'fx-9')).toBe('url(#fx-9)');
    expect(fxFilterRef({}, 'fx-9')).toBeUndefined();
    expect(fxFilterRef({ vignette: 1 }, 'fx-9')).toBeUndefined();
  });
});

describe('vignette', () => {
  it('darkens further and starts closer to the centre as it strengthens', () => {
    const light = vignetteStops(0.2);
    const heavy = vignetteStops(0.9);
    expect(heavy.outerOpacity).toBeGreaterThan(light.outerOpacity);
    expect(heavy.inner).toBeLessThan(light.inner);
  });

  it('clamps out-of-range input', () => {
    expect(vignetteStops(5).outerOpacity).toBeLessThanOrEqual(0.92);
    expect(vignetteStops(-3).outerOpacity).toBe(0);
  });

  it('describes the same ramp in CSS and in SVG', () => {
    // The two renderers must agree; this is the shared-source-of-truth check
    // for the one effect that is painted rather than filtered.
    const amount = 0.55;
    const { inner, outerOpacity } = vignetteStops(amount);
    const css = vignetteCssGradient(amount);
    const svg = vignetteSvgGradientDef(amount, 'vig-1');

    expect(css).toContain(`${inner}%`);
    expect(css).toContain(`${outerOpacity})`);
    expect(svg).toContain(`offset="${inner}%"`);
    expect(svg).toContain(`stop-opacity="${outerOpacity}"`);
  });

  it('gives the gradient the id it is asked for', () => {
    expect(vignetteSvgGradientDef(0.4, 'vig-layer-3')).toContain('id="vig-layer-3"');
  });
});

describe('presets', () => {
  it('exposes a neutral reset', () => {
    expect(fxPresetById('clean')).toEqual({});
    expect(hasAnyFx(fxPresetById('clean'))).toBe(false);
  });

  it('has unique ids', () => {
    const ids = fxPresets.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces a well-threaded filter for every preset', () => {
    for (const preset of fxPresets) {
      const def = buildFxFilterDef(preset.fx, `fx-${preset.id}`, 1, 400);
      if (def) {
        assertChainIsThreaded(def);
        assertNoDuplicateAttributes(def);
        expect(def).not.toContain('NaN');
      }
    }
  });

  it('resolves an unknown id to neutral instead of throwing', () => {
    expect(fxPresetById('does-not-exist')).toEqual({});
  });
});
