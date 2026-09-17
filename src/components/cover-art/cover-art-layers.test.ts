import { describe, expect, it } from 'vitest';
import {
  addLayer,
  alignLayers,
  createArtworkDocument,
  createImageLayer,
  createShapeLayer,
  createTextLayer,
  createTextureLayer,
  createWaveformLayer,
  childrenOf,
  descendantIds,
  distributeLayers,
  documentGuides,
  duplicateLayers,
  expandToLeaves,
  groupBounds,
  groupLayers,
  isDescendantOf,
  layerRows,
  topLevelLayers,
  ungroupLayers,
  imageCropDefaults,
  imageFrameRect,
  removeLayers,
  renderArtworkDocumentSvg,
  reorderLayer,
  sortArtworkLayers,
  type ImageArtworkLayer,
} from './cover-art-document';
import { collectUsedFontAssets } from '@/lib/cover/font-embed';
import { textPathD, textPathDefaults } from '@/lib/cover/text-path';

const baseDocument = () => createArtworkDocument('de-roche-mineral', { kind: 'empty', label: 'Empty design' });

describe('layer factories', () => {
  it('centres a new text layer in the artboard', () => {
    const document = baseDocument();
    const layer = createTextLayer(document, 'HELLO');
    expect(layer.text).toBe('HELLO');
    expect(layer.x).toBe(Math.round((document.width - layer.width) / 2));
    expect(layer.y).toBe(Math.round((document.height - layer.height) / 2));
  });

  it('stacks each new layer above every existing one', () => {
    const document = baseDocument();
    const highest = Math.max(...document.layers.map((layer) => layer.zIndex));
    expect(createShapeLayer(document).zIndex).toBe(highest + 1);
  });

  it('gives every new layer a distinct id', () => {
    const document = baseDocument();
    const ids = [
      createTextLayer(document).id,
      createImageLayer(document, 'data:image/png;base64,AAA').id,
      createShapeLayer(document).id,
      createTextureLayer(document).id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it('reuses loaded peaks when adding a second waveform layer', () => {
    const document = baseDocument();
    const existing = document.layers.find((layer) => layer.type === 'waveform');
    const added = createWaveformLayer(document);
    expect(added.peaks).toEqual(existing && 'peaks' in existing ? existing.peaks : undefined);
  });

  it('creates an image layer with crop defaults already applied', () => {
    const layer = createImageLayer(baseDocument(), 'data:image/png;base64,AAA', 'Shot');
    expect(imageCropDefaults(layer)).toEqual({
      fit: 'cover', offsetX: 0, offsetY: 0, scale: 1, radius: 0, mask: 'none',
    });
  });
});

describe('document operations', () => {
  it('adds a layer without touching the others', () => {
    const document = baseDocument();
    const next = addLayer(document, createShapeLayer(document, 'circle'));
    expect(next.layers).toHaveLength(document.layers.length + 1);
    expect(next.layers.slice(0, -1)).toEqual(document.layers);
  });

  it('refuses to delete a locked layer', () => {
    const document = baseDocument();
    const locked = document.layers.find((layer) => layer.locked);
    expect(locked).toBeTruthy();
    expect(removeLayers(document, [locked!.id])).toBe(document);
  });

  it('deletes unlocked layers', () => {
    const document = baseDocument();
    const title = document.layers.find((layer) => layer.name === 'Main Title')!;
    const next = removeLayers(document, [title.id]);
    expect(next.layers.find((layer) => layer.id === title.id)).toBeUndefined();
  });

  it('duplicates with a fresh id, an offset and no lock', () => {
    const document = baseDocument();
    const source = document.layers.find((layer) => layer.name === 'Main Title')!;
    const { document: next, ids } = duplicateLayers(document, [source.id]);
    const clone = next.layers.find((layer) => layer.id === ids[0])!;
    expect(clone.id).not.toBe(source.id);
    expect(clone.x).toBe(source.x + 80);
    expect(clone.locked).toBe(false);
    // A deep copy: mutating the clone's peaks must not reach the original.
    expect(next.layers.find((layer) => layer.id === source.id)).toEqual(source);
  });

  it('sends a layer to the front and to the back', () => {
    const document = baseDocument();
    const first = sortArtworkLayers(document.layers)[0];
    const toFront = reorderLayer(document.layers, first.id, 'front');
    expect(sortArtworkLayers(toFront).at(-1)!.id).toBe(first.id);
    const backAgain = reorderLayer(toFront, first.id, 'back');
    expect(sortArtworkLayers(backAgain)[0].id).toBe(first.id);
    expect(sortArtworkLayers(backAgain).map((layer) => layer.zIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('aligns a single layer against the artboard', () => {
    const document = baseDocument();
    const title = document.layers.find((layer) => layer.name === 'Main Title')!;
    const next = alignLayers(document, [title.id], 'left');
    expect(next.layers.find((layer) => layer.id === title.id)!.x).toBe(0);
  });

  it('aligns several layers against their own bounding box', () => {
    let document = baseDocument();
    const a = createShapeLayer(document, 'rect', { x: 100, y: 100, width: 200, height: 200 });
    document = addLayer(document, a);
    const b = createShapeLayer(document, 'rect', { x: 900, y: 400, width: 200, height: 200 });
    document = addLayer(document, b);
    const next = alignLayers(document, [a.id, b.id], 'left');
    expect(next.layers.find((layer) => layer.id === b.id)!.x).toBe(100);
  });

  it('distributes three layers to even gaps', () => {
    let document = baseDocument();
    const made = [0, 500, 1400].map((x) => createShapeLayer(document, 'rect', { x, y: 0, width: 100, height: 100 }));
    made.forEach((layer) => { document = addLayer(document, layer); });
    const next = distributeLayers(document, made.map((layer) => layer.id), 'x');
    const xs = made.map((layer) => next.layers.find((item) => item.id === layer.id)!.x);
    expect(xs[1] - xs[0]).toBe(xs[2] - xs[1]);
  });

  it('leaves fewer than three layers alone when distributing', () => {
    const document = baseDocument();
    const ids = document.layers.slice(0, 2).map((layer) => layer.id);
    expect(distributeLayers(document, ids, 'x')).toBe(document);
  });
});

describe('image cropping', () => {
  it('centres the image when there is no zoom', () => {
    const layer = createImageLayer(baseDocument(), 'data:image/png;base64,AAA');
    const rect = imageFrameRect(layer);
    expect(rect).toMatchObject({ x: 0, y: 0, width: layer.width, height: layer.height });
  });

  it('centres the overflow when zoomed with no pan', () => {
    const base = createImageLayer(baseDocument(), 'data:image/png;base64,AAA');
    const layer: ImageArtworkLayer = { ...base, width: 1000, height: 1000, scale: 2 };
    expect(imageFrameRect(layer)).toMatchObject({ x: -500, y: -500, width: 2000, height: 2000 });
  });

  it('pans to the edge of the overflow at the extremes', () => {
    const base = createImageLayer(baseDocument(), 'data:image/png;base64,AAA');
    const layer: ImageArtworkLayer = { ...base, width: 1000, height: 1000, scale: 2 };
    expect(imageFrameRect({ ...layer, offsetX: 1 }).x).toBe(0);
    expect(imageFrameRect({ ...layer, offsetX: -1 }).x).toBe(-1000);
  });
});

describe('svg rendering', () => {
  it('draws the image source rather than the placeholder', () => {
    let document = baseDocument();
    document = addLayer(document, createImageLayer(document, 'data:image/png;base64,ABC', 'Shot'));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('href="data:image/png;base64,ABC"');
    expect(svg).toContain('clip-path="url(#clip-');
  });

  it('escapes text so a quote cannot break out of the markup', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'A "<b>" & C'));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('&quot;&lt;B&gt;&quot; &amp; C');
    expect(svg).not.toContain('<b>');
  });

  it('splits newlines into tspans so multi-line text survives export', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'LINE ONE\nLINE TWO'));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('LINE ONE</tspan>');
    expect(svg).toContain('LINE TWO</tspan>');
  });

  it('rounds rectangle corners and renders a triangle', () => {
    let document = baseDocument();
    document = addLayer(document, createShapeLayer(document, 'rect', { cornerRadius: 48 }));
    document = addLayer(document, createShapeLayer(document, 'triangle'));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('rx="48"');
    expect(svg).toContain('<polygon');
  });

  it('gives each texture kind its own fill', () => {
    let document = baseDocument();
    document = addLayer(document, createTextureLayer(document, 'halftone'));
    expect(renderArtworkDocumentSvg(document)).toContain('url(#texHalftone)');
  });

  it('skips hidden layers', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'SHOULD NOT APPEAR', { visible: false }));
    expect(renderArtworkDocumentSvg(document)).not.toContain('SHOULD NOT APPEAR');
  });
});

/**
 * The exported SVG is rasterised by loading it through `new Image()`, and that
 * path parses it as strict XML. A single malformed tag makes the whole export
 * fail with "Unable to load rendered cover SVG" — which is exactly what a
 * duplicate `style` attribute on `<text>` used to do to every cover that had
 * any text on it. These guard the markup itself rather than the pixels.
 */
describe('exported svg is well-formed', () => {
  /** Every opening tag in the document, with its raw attribute text. */
  function tags(svg: string) {
    return [...svg.matchAll(/<([a-zA-Z][\w:-]*)\s([^>]*?)\/?>/g)]
      .map((match) => ({ name: match[1], attrs: match[2] }));
  }

  function duplicateAttributes(attrs: string) {
    const names = [...attrs.matchAll(/(^|\s)([a-zA-Z][\w:-]*)\s*=\s*"/g)].map((m) => m[2]);
    return names.filter((name, index) => names.indexOf(name) !== index);
  }

  function richDocument() {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'MIDNIGHT CARTEL'));
    document = addLayer(document, createTextLayer(document, 'A\nB', { stroke: '#fff', strokeWidth: 6 }));
    document = addLayer(document, createImageLayer(document, 'data:image/png;base64,AAA'));
    document = addLayer(document, createShapeLayer(document, 'rect', { cornerRadius: 20 }));
    document = addLayer(document, createShapeLayer(document, 'triangle'));
    document = addLayer(document, createShapeLayer(document, 'circle'));
    document = addLayer(document, createTextureLayer(document, 'halftone'));
    return document;
  }

  it('never repeats an attribute on any element', () => {
    const offenders = tags(renderArtworkDocumentSvg(richDocument()))
      .map((tag) => ({ tag: tag.name, duplicates: duplicateAttributes(tag.attrs) }))
      .filter((entry) => entry.duplicates.length > 0);
    expect(offenders).toEqual([]);
  });

  it('never gives any element two style attributes', () => {
    // The original failure: a caller appending a second `style=` produced
    // `<text style="…" style="font-weight:700">`, which is invalid XML, so the
    // SVG failed to load as an image and every export of a cover containing
    // text died. Asserted across every tag rather than only <text>, because the
    // bug is about attribute construction, not about text specifically.
    const all = tags(renderArtworkDocumentSvg(richDocument()));
    expect(all.length).toBeGreaterThan(0);
    all.forEach((tag) => {
      expect((tag.attrs.match(/\sstyle=/g) ?? []).length, `${tag.name} has two style attributes`)
        .toBeLessThanOrEqual(1);
    });
  });

  it('carries the blend mode on the layer wrapper', () => {
    // Blend, opacity and the transform live on a wrapping <g> so an effect
    // filter can nest between them and the content. Every visible layer must
    // still declare its blend mode somewhere, or blending silently stops.
    const svg = renderArtworkDocumentSvg(richDocument());
    const groups = tags(svg).filter((tag) => tag.name === 'g' && tag.attrs.includes('mix-blend-mode:'));
    const visible = richDocument().layers.filter((layer) => layer.visible);
    expect(groups.length).toBe(visible.length);
    groups.forEach((group) => {
      expect(group.attrs).toContain('transform="translate(');
      expect(group.attrs).toContain('opacity=');
    });
  });

  it('writes the layer’s own type weight rather than a hardcoded bold', () => {
    // This used to be `font-weight:700` on every text node regardless of what
    // the layer asked for, while the canvas set no weight at all.
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'LIGHT', {
      fontFamily: 'panchang', fontWeight: 200,
    }));
    document = addLayer(document, createTextLayer(document, 'HEAVY', {
      fontFamily: 'panchang', fontWeight: 800,
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('style="font-weight:200"');
    expect(svg).toContain('style="font-weight:800"');
  });

  it('snaps a requested weight the family does not ship', () => {
    // Synkopy has 400 and 700 only. Emitting an unsnapped 500 would ask the
    // page's font engine and an isolated SVG's to each invent a weight, and
    // they do not invent the same one.
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'TITLE', {
      fontFamily: 'synkopy', fontWeight: 500,
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('style="font-weight:400"');
    expect(svg).not.toContain('style="font-weight:500"');
  });

  it('balances every tag it opens', () => {
    const svg = renderArtworkDocumentSvg(richDocument());
    const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/)?>/g)]
      .filter((match) => !match[3])
      .map((match) => match[1]);
    const closed = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)].map((match) => match[1]);
    const count = (list: string[], name: string) => list.filter((item) => item === name).length;
    [...new Set(opened)].forEach((name) => {
      expect(`${name}:${count(opened, name)}`).toBe(`${name}:${count(closed, name)}`);
    });
  });

  it('quotes every attribute value', () => {
    tags(renderArtworkDocumentSvg(richDocument())).forEach((tag) => {
      // An unquoted value would show up as `name=` followed by a non-quote.
      expect(tag.attrs).not.toMatch(/=\s*[^"\s>]/);
    });
  });
});

describe('brand typography', () => {
  it('sets the artist name in the brand face by default', () => {
    const artist = baseDocument().layers.find((layer) => layer.name === 'Artist Name');
    expect(artist).toMatchObject({ type: 'text', fontFamily: 'brand' });
  });

  it('renders the brand role as Akira with nothing ahead of it in the stack', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'UCHE', { fontFamily: 'brand' }));
    const svg = renderArtworkDocumentSvg(document);
    const leadFamilies = [...svg.matchAll(/font-family="([^"]+)"/g)]
      .map((match) => match[1].replaceAll("'", '').split(',')[0].trim());
    // Synkopy ahead of Akira is what stopped Akira ever rendering before, so
    // the assertion is about ORDER: some stack must LEAD with Akira. Merely
    // containing it is not enough — the Synkopy stack contains it as a
    // fallback and that is precisely the arrangement that never rendered.
    expect(leadFamilies).toContain('Akira Expanded');
  });
});

describe('effects in the export', () => {
  const withFx = (fx: Record<string, unknown>) => {
    let document = baseDocument();
    document = addLayer(document, createShapeLayer(document, 'rect'));
    const target = document.layers[document.layers.length - 1];
    return {
      document: {
        ...document,
        layers: document.layers.map((layer) => (layer.id === target.id ? { ...layer, fx } : layer)),
      },
      id: target.id,
    };
  };

  it('emits no filter def for a layer with no effects', () => {
    const svg = renderArtworkDocumentSvg(baseDocument());
    expect(svg).not.toContain('id="fx-');
  });

  it('emits a filter def and points the layer at it', () => {
    const { document, id } = withFx({ blur: 12 });
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain(`<filter id="fx-${id}"`);
    expect(svg).toContain(`filter="url(#fx-${id})"`);
  });

  it('puts the filter def inside defs, where a reference can resolve it', () => {
    const { document, id } = withFx({ blur: 12 });
    const svg = renderArtworkDocumentSvg(document);
    expect(svg.indexOf(`<filter id="fx-${id}"`)).toBeLessThan(svg.indexOf('</defs>'));
  });

  it('nests the filter INSIDE the transform, so a rotated layer’s shadow rotates too', () => {
    // CSS does this natively on the canvas. Hoisting the filter above the
    // transform here would give the export document-space shadows and the
    // canvas layer-space ones — the same layer, two different pictures.
    const { document, id } = withFx({ shadow: { x: 8, y: 8, blur: 4, color: '#000', opacity: 0.6 } });
    const svg = renderArtworkDocumentSvg(document);
    const wrapper = svg.indexOf('transform="translate(');
    const filtered = svg.indexOf(`<g filter="url(#fx-${id})">`);
    expect(wrapper).toBeGreaterThan(-1);
    expect(filtered).toBeGreaterThan(wrapper);
  });

  it('keeps the filter off the element that carries the clip path', () => {
    // A filter and a clip-path on one element clip the drop shadow away with
    // the crop, so the shadow silently vanishes on exactly the image layers
    // most likely to want one.
    let document = baseDocument();
    document = addLayer(document, createImageLayer(document, 'data:image/png;base64,AAA', 'Art'));
    const target = document.layers[document.layers.length - 1] as ImageArtworkLayer;
    document = {
      ...document,
      layers: document.layers.map((layer) => (layer.id === target.id
        ? { ...layer, src: 'data:image/png;base64,AAA', fx: { blur: 6 } }
        : layer)),
    };
    const svg = renderArtworkDocumentSvg(document);
    const clipped = svg.match(/<g clip-path="url\(#clip-[^"]+\)">/g) ?? [];
    expect(clipped.length).toBe(1);
    clipped.forEach((tag) => expect(tag).not.toContain('filter='));
  });

  it('paints the vignette outside the filter group so a blur cannot smear it', () => {
    const { document, id } = withFx({ blur: 20, vignette: 0.6 });
    const svg = renderArtworkDocumentSvg(document);
    const filterClose = svg.indexOf('</g>', svg.indexOf(`<g filter="url(#fx-${id})">`));
    const vignetteRect = svg.indexOf(`fill="url(#vig-${id})"`);
    expect(vignetteRect).toBeGreaterThan(filterClose);
  });

  it('emits a vignette gradient without a filter when vignette is the only effect', () => {
    const { document, id } = withFx({ vignette: 0.5 });
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain(`<radialGradient id="vig-${id}"`);
    expect(svg).not.toContain(`<filter id="fx-${id}"`);
  });

  it('keeps the document well-formed with every effect switched on', () => {
    const { document } = withFx({
      exposure: 0.3, brightness: 1.1, contrast: 1.2, saturation: 0.6, hue: 20,
      blur: 4, sharpen: 0.3, grain: 0.4, vignette: 0.5, chromatic: 6, posterize: 5,
      gradientMap: { from: '#0C0C0A', to: '#C8A47A', amount: 0.8 },
      shadow: { x: 6, y: 6, blur: 10, color: '#000000', opacity: 0.5 },
      glow: { blur: 14, color: '#F2F2F0', opacity: 0.4 },
    });
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).not.toContain('NaN');
    expect(svg).not.toContain('undefined');
    const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/)?>/g)]
      .filter((match) => !match[3])
      .map((match) => match[1]);
    const closed = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)].map((match) => match[1]);
    const count = (list: string[], name: string) => list.filter((item) => item === name).length;
    [...new Set(opened)].forEach((name) => {
      expect(`${name}:${count(opened, name)}`).toBe(`${name}:${count(closed, name)}`);
    });
  });
});

describe('guides never reach an export', () => {
  /**
   * Guides live on the document so they persist with the artwork, which means
   * the only thing stopping one being baked into a finished cover is that the
   * exporter does not read them. That is a property worth a test rather than a
   * comment — a magenta line rasterised into a release cover is the kind of
   * bug that gets discovered by a distributor.
   */
  const withGuides = () => ({
    ...baseDocument(),
    guides: { x: [100, 1500, 2900], y: [250, 2750] },
  });

  it('renders no guide geometry into the SVG', () => {
    const svg = renderArtworkDocumentSvg(withGuides());
    const plain = renderArtworkDocumentSvg(baseDocument());
    // Byte-identical apart from nothing: guides change the document object and
    // must change the output not at all.
    expect(svg).toBe(plain);
  });

  it('produces the same output whether guides are set, empty or absent', () => {
    const base = baseDocument();
    const empty = renderArtworkDocumentSvg({ ...base, guides: { x: [], y: [] } });
    const absent = renderArtworkDocumentSvg(base);
    const populated = renderArtworkDocumentSvg(withGuides());
    expect(empty).toBe(absent);
    expect(populated).toBe(absent);
  });

  it('reads guides through the shared default so an older document still opens', () => {
    expect(documentGuides(baseDocument())).toEqual({ x: [], y: [] });
    expect(documentGuides(withGuides()).x).toEqual([100, 1500, 2900]);
  });

  it('survives a hand-edited document with junk in the guides', () => {
    const broken = { ...baseDocument(), guides: { x: [10, Number.NaN], y: undefined } } as never;
    expect(() => renderArtworkDocumentSvg(broken)).not.toThrow();
    expect(documentGuides(broken)).toEqual({ x: [10], y: [] });
  });
});

describe('layer groups', () => {
  const twoShapes = () => {
    let document = baseDocument();
    const a = createShapeLayer(document, 'rect', { x: 100, y: 100, width: 200, height: 200 });
    document = addLayer(document, a);
    const b = createShapeLayer(document, 'circle', { x: 500, y: 400, width: 300, height: 300 });
    document = addLayer(document, b);
    return { document, a, b };
  };

  describe('groupLayers', () => {
    it('moves the members under a new group', () => {
      const { document, a, b } = twoShapes();
      const { document: next, id } = groupLayers(document, [a.id, b.id]);
      expect(id).not.toBeNull();
      expect(next.layers.find((layer) => layer.id === a.id)!.parentId).toBe(id);
      expect(next.layers.find((layer) => layer.id === b.id)!.parentId).toBe(id);
      expect(next.layers.find((layer) => layer.id === id)!.type).toBe('group');
    });

    it('takes the bounding box of its members', () => {
      const { document, a, b } = twoShapes();
      const { document: next, id } = groupLayers(document, [a.id, b.id]);
      const group = next.layers.find((layer) => layer.id === id)!;
      expect(group).toMatchObject({ x: 100, y: 100, width: 700, height: 600 });
    });

    it('refuses to group a locked layer', () => {
      const { document, a } = twoShapes();
      const locked = { ...document, layers: document.layers.map((l) => (l.id === a.id ? { ...l, locked: true } : l)) };
      const { document: next, id } = groupLayers(locked, [a.id]);
      expect(id).toBeNull();
      expect(next).toBe(locked);
    });

    it('returns a null id when nothing groupable was given', () => {
      const { document } = twoShapes();
      expect(groupLayers(document, []).id).toBeNull();
      expect(groupLayers(document, ['nope']).id).toBeNull();
    });

    it('keeps the group where its topmost member was, so stacking is unchanged', () => {
      const { document, a, b } = twoShapes();
      const topZ = Math.max(a.zIndex, b.zIndex);
      const { document: next, id } = groupLayers(document, [a.id, b.id]);
      const group = next.layers.find((layer) => layer.id === id)!;
      const others = next.layers.filter((l) => !l.parentId && l.id !== id);
      // Everything that was below both members stays below the group.
      expect(group.zIndex).toBeGreaterThanOrEqual(
        Math.max(...others.filter((l) => l.zIndex < topZ).map((l) => l.zIndex), -1),
      );
    });

    it('nests inside a shared parent, and flattens a mixed selection', () => {
      const { document, a, b } = twoShapes();
      const { document: inner, id: innerId } = groupLayers(document, [a.id, b.id]);
      // Both members share the inner group as a parent → the new group nests.
      const { document: nested, id: nestedId } = groupLayers(inner, [a.id, b.id]);
      expect(nested.layers.find((l) => l.id === nestedId)!.parentId).toBe(innerId);

      // A member from inside the group plus one from outside → top level.
      // Must be an UNLOCKED layer: `groupLayers` skips locked ones, so picking
      // the locked background would leave a single-parent selection and test
      // the opposite of what this is about.
      const outside = nested.layers.find((l) => !l.parentId && l.type !== 'group' && !l.locked)!;
      const { document: mixed, id: mixedId } = groupLayers(nested, [a.id, outside.id]);
      expect(mixed.layers.find((l) => l.id === mixedId)!.parentId).toBeUndefined();
    });
  });

  describe('ungroupLayers', () => {
    it('promotes children and removes the group', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const next = ungroupLayers(grouped, id!);
      expect(next.layers.find((layer) => layer.id === id)).toBeUndefined();
      expect(next.layers.find((layer) => layer.id === a.id)!.parentId).toBeUndefined();
      expect(next.layers.find((layer) => layer.id === b.id)!.parentId).toBeUndefined();
    });

    it('keeps the children where the group sat in the stack', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const next = ungroupLayers(grouped, id!);
      const order = topLevelLayers(next.layers).map((layer) => layer.id);
      // The two former members stay adjacent and stay in their own order.
      expect(Math.abs(order.indexOf(a.id) - order.indexOf(b.id))).toBe(1);
      expect(order.indexOf(a.id)).toBeLessThan(order.indexOf(b.id));
    });

    it('leaves no two siblings sharing a z index', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const next = ungroupLayers(grouped, id!);
      const zs = next.layers.filter((l) => !l.parentId).map((l) => l.zIndex);
      expect(new Set(zs).size).toBe(zs.length);
    });

    it('refuses to ungroup a locked group, or a layer that is not a group', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const locked = {
        ...grouped,
        layers: grouped.layers.map((l) => (l.id === id ? { ...l, locked: true } : l)),
      };
      expect(ungroupLayers(locked, id!)).toBe(locked);
      expect(ungroupLayers(grouped, a.id)).toBe(grouped);
    });
  });

  describe('tree queries', () => {
    it('lists direct children in stacking order', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      expect(childrenOf(grouped.layers, id!).map((l) => l.id)).toEqual([a.id, b.id]);
    });

    it('walks descendants through nesting', () => {
      const { document, a, b } = twoShapes();
      const { document: inner, id: innerId } = groupLayers(document, [a.id, b.id]);
      const { document: outer, id: outerId } = groupLayers(inner, [innerId!]);
      expect(descendantIds(outer.layers, outerId!).sort())
        .toEqual([innerId!, a.id, b.id].sort());
    });

    it('survives a parent cycle rather than blowing the stack', () => {
      // A hand-edited document, or a future bug in a move operation, can point
      // a group at its own descendant. Recursing forever takes the whole studio
      // down; returning something finite degrades instead.
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const cyclic = {
        ...grouped,
        layers: grouped.layers.map((l) => (l.id === id ? { ...l, parentId: a.id } : l)),
      };
      expect(() => descendantIds(cyclic.layers, id!)).not.toThrow();
      expect(() => expandToLeaves(cyclic.layers, [id!])).not.toThrow();
      expect(() => isDescendantOf(cyclic.layers, a.id, id!)).not.toThrow();
      expect(() => layerRows(cyclic.layers)).not.toThrow();
    });

    it('expands a group to its drawable leaves, never the group itself', () => {
      const { document, a, b } = twoShapes();
      const { document: inner, id: innerId } = groupLayers(document, [a.id, b.id]);
      const { document: outer, id: outerId } = groupLayers(inner, [innerId!]);
      const leaves = expandToLeaves(outer.layers, [outerId!]);
      expect(leaves.sort()).toEqual([a.id, b.id].sort());
      expect(leaves).not.toContain(innerId);
      expect(leaves).not.toContain(outerId);
    });

    it('leaves a plain selection alone and deduplicates', () => {
      const { document, a, b } = twoShapes();
      expect(expandToLeaves(document.layers, [a.id, b.id, a.id])).toEqual([a.id, b.id]);
    });

    it('derives group bounds from its contents', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      expect(groupBounds(grouped.layers, id!)).toEqual({ x: 100, y: 100, width: 700, height: 600 });
    });

    it('reports null bounds for an empty group', () => {
      let document = baseDocument();
      const shape = createShapeLayer(document, 'rect');
      document = addLayer(document, shape);
      const { document: grouped, id } = groupLayers(document, [shape.id]);
      const emptied = { ...grouped, layers: grouped.layers.filter((l) => l.id !== shape.id) };
      expect(groupBounds(emptied.layers, id!)).toBeNull();
    });
  });

  describe('layerRows', () => {
    it('lists front-to-back, which is how a layers panel reads', () => {
      const { document } = twoShapes();
      const rows = layerRows(document.layers);
      const zs = rows.map((row) => row.layer.zIndex);
      expect(zs).toEqual([...zs].sort((x, y) => y - x));
    });

    it('indents children beneath their group', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const rows = layerRows(grouped.layers);
      const groupRow = rows.find((row) => row.layer.id === id)!;
      const childRow = rows.find((row) => row.layer.id === a.id)!;
      expect(groupRow.depth).toBe(0);
      expect(childRow.depth).toBe(1);
      expect(groupRow.hasChildren).toBe(true);
    });

    it('omits the children of a collapsed group entirely', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const collapsed = {
        ...grouped,
        layers: grouped.layers.map((l) => (l.id === id ? { ...l, collapsed: true } : l)),
      };
      const ids = layerRows(collapsed.layers).map((row) => row.layer.id);
      expect(ids).toContain(id);
      expect(ids).not.toContain(a.id);
      expect(ids).not.toContain(b.id);
    });

    it('includes every layer exactly once when nothing is collapsed', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped } = groupLayers(document, [a.id, b.id]);
      const ids = layerRows(grouped.layers).map((row) => row.layer.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(grouped.layers.length);
    });
  });

  describe('deleting and duplicating a group', () => {
    it('takes the contents with it when a group is deleted', () => {
      // Orphaned children would keep a parentId pointing at nothing, and every
      // render path walks down from the top — so they would vanish from view
      // without actually being gone.
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const next = removeLayers(grouped, [id!]);
      expect(next.layers.find((l) => l.id === a.id)).toBeUndefined();
      expect(next.layers.find((l) => l.id === b.id)).toBeUndefined();
    });

    it('never leaves a layer pointing at a parent that no longer exists', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const next = removeLayers(grouped, [id!]);
      const ids = new Set(next.layers.map((l) => l.id));
      next.layers.forEach((layer) => {
        if (layer.parentId) expect(ids.has(layer.parentId)).toBe(true);
      });
    });

    it('duplicates the whole subtree and re-points the copies at the copy', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const { document: next, ids } = duplicateLayers(grouped, [id!]);
      expect(ids).toHaveLength(1);
      const cloneId = ids[0];
      const clonedChildren = next.layers.filter((l) => l.parentId === cloneId);
      expect(clonedChildren).toHaveLength(2);
      // The originals are untouched.
      expect(next.layers.filter((l) => l.parentId === id)).toHaveLength(2);
    });

    it('offsets the copied contents so the duplicate is visible', () => {
      // A group draws nothing itself, so offsetting only the group would leave
      // the copy exactly on top of the original and look like a no-op.
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const { document: next, ids } = duplicateLayers(grouped, [id!], 80);
      const clonedA = next.layers.filter((l) => l.parentId === ids[0])[0];
      expect(clonedA.x).toBe(a.x + 80);
      expect(clonedA.y).toBe(a.y + 80);
    });

    it('selects only the copied group, not its copied children', () => {
      // Selecting both would make the next drag move the contents twice.
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const { ids } = duplicateLayers(grouped, [id!]);
      expect(ids).toEqual([ids[0]]);
    });
  });

  describe('reordering respects the sibling set', () => {
    it('keeps a layer inside its group when sent to the front', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const layers = reorderLayer(grouped.layers, a.id, 'front');
      expect(layers.find((l) => l.id === a.id)!.parentId).toBe(id);
      expect(childrenOf(layers, id!).at(-1)!.id).toBe(a.id);
    });

    it('does not drop any layer from the document', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      for (const move of ['front', 'back', 'forward', 'backward'] as const) {
        expect(reorderLayer(grouped.layers, a.id, move)).toHaveLength(grouped.layers.length);
        expect(reorderLayer(grouped.layers, id!, move)).toHaveLength(grouped.layers.length);
      }
    });
  });

  describe('rendering a group', () => {
    it('nests the children inside the group wrapper', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const withOpacity = {
        ...grouped,
        layers: grouped.layers.map((l) => (l.id === id ? { ...l, opacity: 0.5 } : l)),
      };
      const svg = renderArtworkDocumentSvg(withOpacity);
      expect(svg).toContain('opacity="0.5"');
      // Group opacity has to wrap the children to mean "fade these as one
      // thing" rather than "fade each of them".
      const groupOpen = svg.indexOf('opacity="0.5"');
      expect(groupOpen).toBeGreaterThan(-1);
    });

    it('gives the group wrapper no transform, since children are absolute', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const svg = renderArtworkDocumentSvg(grouped);
      const wrappers = svg.match(/<g opacity="[^"]*" style="mix-blend-mode:[^"]*">/g) ?? [];
      // Exactly one wrapper without a transform: the group. Everything else
      // carries its own placement.
      expect(wrappers.length).toBe(1);
      expect(id).not.toBeNull();
    });

    it('draws nothing for a hidden group, including its children', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped, id } = groupLayers(document, [a.id, b.id]);
      const hidden = {
        ...grouped,
        layers: grouped.layers.map((l) => (l.id === id ? { ...l, visible: false } : l)),
      };
      const svg = renderArtworkDocumentSvg(hidden);
      const shown = renderArtworkDocumentSvg(grouped);
      expect(svg.length).toBeLessThan(shown.length);
    });

    it('stays well-formed with a group in the document', () => {
      const { document, a, b } = twoShapes();
      const { document: grouped } = groupLayers(document, [a.id, b.id]);
      const svg = renderArtworkDocumentSvg(grouped);
      const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/)?>/g)]
        .filter((match) => !match[3])
        .map((match) => match[1]);
      const closed = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)].map((match) => match[1]);
      const count = (list: string[], name: string) => list.filter((item) => item === name).length;
      [...new Set(opened)].forEach((name) => {
        expect(`${name}:${count(opened, name)}`).toBe(`${name}:${count(closed, name)}`);
      });
    });
  });
});

describe('pressing inside a selected group', () => {
  /**
   * The canvas keeps a group selected when the press lands on one of its
   * descendants. Without it, grabbing a group's contents replaced the
   * selection with the single child under the cursor and a selected group
   * could never be dragged.
   */
  it('reports a child as a descendant of its group', () => {
    let document = baseDocument();
    const a = createShapeLayer(document, 'rect', { x: 0, y: 0, width: 100, height: 100 });
    document = addLayer(document, a);
    const b = createShapeLayer(document, 'circle', { x: 200, y: 200, width: 100, height: 100 });
    document = addLayer(document, b);
    const { document: grouped, id } = groupLayers(document, [a.id, b.id]);

    expect(isDescendantOf(grouped.layers, a.id, id!)).toBe(true);
    expect(isDescendantOf(grouped.layers, b.id, id!)).toBe(true);
    // A layer outside the group is not, so an unrelated press still reselects.
    const outside = grouped.layers.find((l) => !l.parentId && l.type !== 'group' && l.id !== id)!;
    expect(isDescendantOf(grouped.layers, outside.id, id!)).toBe(false);
  });

  it('sees through nesting', () => {
    let document = baseDocument();
    const a = createShapeLayer(document, 'rect');
    document = addLayer(document, a);
    const { document: inner, id: innerId } = groupLayers(document, [a.id]);
    const { document: outer, id: outerId } = groupLayers(inner, [innerId!]);
    expect(isDescendantOf(outer.layers, a.id, outerId!)).toBe(true);
  });
});

describe('text on a path', () => {
  const curved = (shape: 'arc' | 'circle' | 'wave', extra = {}) => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'MIDNIGHT CARTEL', {
      path: { shape, curvature: 0.5 }, ...extra,
    }));
    return document;
  };

  it('emits a path def and a textPath that references it', () => {
    const svg = renderArtworkDocumentSvg(curved('arc'));
    const id = /<path id="(tp-[^"]+)"/.exec(svg)?.[1];
    expect(id).toBeTruthy();
    expect(svg).toContain(`<textPath href="#${id}"`);
  });

  it('puts the path def inside defs, where the reference can resolve it', () => {
    const svg = renderArtworkDocumentSvg(curved('arc'));
    expect(svg.indexOf('<path id="tp-')).toBeLessThan(svg.indexOf('</defs>'));
  });

  it('leaves flat text as an ordinary text element', () => {
    const svg = renderArtworkDocumentSvg(baseDocument());
    expect(svg).not.toContain('<textPath');
    expect(svg).not.toContain('<path id="tp-');
  });

  it('collapses line breaks into one run, since a path has no lines', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'TWO\nLINES', {
      path: { shape: 'arc', curvature: 0.4 },
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('>TWO LINES</textPath>');
    // No tspan rows for a curved layer — they mean nothing on a path.
    expect(/<textPath[^>]*>[^<]*<tspan/.test(svg)).toBe(false);
  });

  it('still applies uppercase, colour, weight and tracking', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'quiet', {
      path: { shape: 'arc', curvature: 0.4 },
      uppercase: true,
      color: '#C8A47A',
      fontFamily: 'panchang',
      fontWeight: 200,
      tracking: 12,
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('>QUIET</textPath>');
    expect(svg).toContain('fill="#C8A47A"');
    expect(svg).toContain('font-weight:200');
    expect(svg).toContain('letter-spacing="12"');
  });

  it('carries the outline through as paint-order stroke', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'EDGE', {
      path: { shape: 'wave', curvature: 0.3 }, stroke: '#000000', strokeWidth: 6,
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('paint-order="stroke"');
    expect(svg).toContain('stroke-width="6"');
  });

  it('pairs the start offset with a matching anchor', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'CENTRED', {
      path: { shape: 'circle', curvature: 0 }, align: 'center',
    }));
    const svg = renderArtworkDocumentSvg(document);
    expect(svg).toContain('text-anchor="middle"');
    expect(svg).toContain('startOffset="50%"');
  });

  it('gives each curved layer its own path id', () => {
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'ONE', { path: { shape: 'arc', curvature: 0.3 } }));
    document = addLayer(document, createTextLayer(document, 'TWO', { path: { shape: 'wave', curvature: 0.3 } }));
    const ids = [...document.layers.filter((l) => l.type === 'text' && l.path)].length;
    const emitted = (renderArtworkDocumentSvg(document).match(/<path id="tp-/g) ?? []).length;
    expect(emitted).toBe(ids);
    const unique = new Set(
      [...renderArtworkDocumentSvg(document).matchAll(/<path id="(tp-[^"]+)"/g)].map((m) => m[1]),
    );
    expect(unique.size).toBe(emitted);
  });

  it('still embeds the font the curved layer uses', () => {
    // A textPath is still a <text> element, so the export must inline its face
    // or it rasterises in a fallback the same way flat text used to.
    let document = baseDocument();
    document = addLayer(document, createTextLayer(document, 'CURVED', {
      path: { shape: 'arc', curvature: 0.4 }, fontFamily: 'panchang', fontWeight: 700,
    }));
    expect(collectUsedFontAssets(document).map((asset) => asset.url))
      .toContain('/fonts/Panchang-Bold.otf');
  });

  it('stays well-formed with curved text in the document', () => {
    const svg = renderArtworkDocumentSvg(curved('circle'));
    expect(svg).not.toContain('NaN');
    const opened = [...svg.matchAll(/<([a-zA-Z][\w:-]*)(\s[^>]*?)?(\/)?>/g)]
      .filter((match) => !match[3])
      .map((match) => match[1]);
    const closed = [...svg.matchAll(/<\/([a-zA-Z][\w:-]*)>/g)].map((match) => match[1]);
    const count = (list: string[], name: string) => list.filter((item) => item === name).length;
    [...new Set(opened)].forEach((name) => {
      expect(`${name}:${count(opened, name)}`).toBe(`${name}:${count(closed, name)}`);
    });
  });
});

describe('the curve in the export is the curve on the canvas', () => {
  /**
   * `LayerView` and `renderArtworkDocumentSvg` both call `textPathD` with the
   * layer's own settings and size. This asserts the export really does emit
   * that exact string — the property the whole "no approximation to drift"
   * claim rests on, and the one that would silently break if either surface
   * started rounding, scaling or offsetting the path for itself.
   */
  it.each(['arc', 'circle', 'wave'] as const)('matches for a %s', (shape) => {
    let document = baseDocument();
    const layer = createTextLayer(document, 'CURVED TITLE', {
      path: { shape, curvature: 0.42 },
    });
    document = addLayer(document, layer);

    const expected = textPathD(
      textPathDefaults(layer.path),
      layer.width,
      layer.height,
    );
    expect(expected).not.toBeNull();

    const svg = renderArtworkDocumentSvg(document);
    const emitted = new RegExp(`<path id="tp-${layer.id}" d="([^"]+)"`).exec(svg)?.[1];
    expect(emitted).toBe(expected);
  });

  it('tracks a resize, so the curve still fits after the layer changes', () => {
    let document = baseDocument();
    const layer = createTextLayer(document, 'CURVED', {
      path: { shape: 'arc', curvature: 0.5 }, width: 1200, height: 400,
    });
    document = addLayer(document, layer);
    const wider = {
      ...document,
      layers: document.layers.map((l) => (l.id === layer.id ? { ...l, width: 2400 } : l)),
    };
    const svg = renderArtworkDocumentSvg(wider);
    const emitted = new RegExp(`<path id="tp-${layer.id}" d="([^"]+)"`).exec(svg)?.[1];
    expect(emitted).toBe(textPathD(textPathDefaults(layer.path), 2400, 400));
    expect(emitted).toContain('2400');
  });
});
