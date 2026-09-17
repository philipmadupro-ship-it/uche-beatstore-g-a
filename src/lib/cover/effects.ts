/**
 * Per-layer adjustments and effects.
 *
 * The studio draws every document twice — once as DOM in `LayerView`, once as
 * SVG in `renderArtworkDocumentSvg` — and a property implemented in only one of
 * them is the exact bug that shipped a canvas full of grey placeholder boxes
 * while the export drew the real thing. Crop maths solved that by sharing one
 * pure function (`imageFrameRect`). Effects solve it harder: instead of writing
 * a CSS filter string for the canvas and SVG filter markup for the export, this
 * module emits **one** `<filter>` definition that both surfaces reference.
 *
 *   canvas → inline the def in a hidden <svg>, then `filter: url(#fx-canvas-ID)`
 *   export → inline the same def in <defs>, then `filter="url(#fx-ID)"`
 *
 * There is no second implementation to fall out of step, so "does the export
 * match the canvas" stops being a question anyone has to remember to ask.
 *
 * The one thing that legitimately differs between the two is *scale*. On the
 * canvas a layer is laid out at `layer.width * zoom` CSS pixels, so a 12-unit
 * blur has to become `12 * zoom` pixels to look the same; in the export the
 * document unit IS the unit, so the scale factor is 1. Every length below is
 * multiplied by `scale` for that reason, and `baseFrequency` — which is a
 * reciprocal of length — is divided by it.
 *
 * Pure by design, per the repo's "pure-logic extract" rule: this is precisely
 * the kind of maths that gets silently reverted when it lives inside a
 * component, so it lives here with tests next to it.
 */

/** Blend modes usable on a layer. CSS `mix-blend-mode` and SVG both accept these. */
export const artworkBlendModes = [
  'normal',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'color-burn',
  'hard-light',
  'soft-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
] as const;

export type ArtworkBlendMode = (typeof artworkBlendModes)[number];

export type ArtworkShadow = {
  /** Offset in document units. */
  x: number;
  y: number;
  blur: number;
  color: string;
  /** 0..1 */
  opacity: number;
};

export type ArtworkGlow = {
  blur: number;
  color: string;
  /** 0..1 */
  opacity: number;
};

/**
 * A gradient map (the general form of the duotone treatment): the layer is
 * flattened to luminance, then that luminance indexes a two-colour ramp.
 * `amount` cross-fades back toward the original so it can be dialled in.
 */
export type ArtworkGradientMap = {
  from: string;
  to: string;
  /** 0..1 — 0 is the untouched layer, 1 is the full remap. */
  amount: number;
};

/**
 * Everything tunable that is not geometry.
 *
 * Every field is optional and every read goes through `fxDefaults`, matching
 * `imageCropDefaults`: documents saved before a control existed must keep
 * opening, and there must be exactly one place that decides what "unset" means.
 */
export type ArtworkLayerFx = {
  /** Stops of exposure, -2..2. 0 is neutral. Applied before brightness. */
  exposure?: number;
  /** 0..2, 1 neutral. */
  brightness?: number;
  /** 0..2, 1 neutral. */
  contrast?: number;
  /** 0..2, 1 neutral. */
  saturation?: number;
  /** Degrees, -180..180. */
  hue?: number;
  /** Gaussian blur radius in document units. */
  blur?: number;
  /** Unsharp amount, 0..1. */
  sharpen?: number;
  /** Film grain, 0..1. */
  grain?: number;
  /** Corner darkening, 0..1. Painted, not filtered — see `vignetteGradient`. */
  vignette?: number;
  /** RGB channel separation in document units. */
  chromatic?: number;
  /** Posterisation steps. 0 or undefined disables; 2..16 is the useful range. */
  posterize?: number;
  gradientMap?: ArtworkGradientMap;
  shadow?: ArtworkShadow;
  glow?: ArtworkGlow;
};

export type ResolvedFx = {
  exposure: number;
  brightness: number;
  contrast: number;
  saturation: number;
  hue: number;
  blur: number;
  sharpen: number;
  grain: number;
  vignette: number;
  chromatic: number;
  posterize: number;
  gradientMap: ArtworkGradientMap | null;
  shadow: ArtworkShadow | null;
  glow: ArtworkGlow | null;
};

export const neutralFx: ResolvedFx = {
  exposure: 0,
  brightness: 1,
  contrast: 1,
  saturation: 1,
  hue: 0,
  blur: 0,
  sharpen: 0,
  grain: 0,
  vignette: 0,
  chromatic: 0,
  posterize: 0,
  gradientMap: null,
  shadow: null,
  glow: null,
};

/** Single source of truth for what an unset effect field means. */
export function fxDefaults(fx: ArtworkLayerFx | undefined): ResolvedFx {
  if (!fx) return neutralFx;
  return {
    exposure: fx.exposure ?? 0,
    brightness: fx.brightness ?? 1,
    contrast: fx.contrast ?? 1,
    saturation: fx.saturation ?? 1,
    hue: fx.hue ?? 0,
    blur: fx.blur ?? 0,
    sharpen: fx.sharpen ?? 0,
    grain: fx.grain ?? 0,
    vignette: fx.vignette ?? 0,
    chromatic: fx.chromatic ?? 0,
    posterize: fx.posterize ?? 0,
    gradientMap: fx.gradientMap && fx.gradientMap.amount > 0 ? fx.gradientMap : null,
    shadow: fx.shadow && fx.shadow.opacity > 0 ? fx.shadow : null,
    glow: fx.glow && fx.glow.opacity > 0 ? fx.glow : null,
  };
}

/** Does this layer need a `<filter>` at all? Layers without one skip it entirely. */
export function hasFilterFx(fx: ArtworkLayerFx | undefined): boolean {
  const r = fxDefaults(fx);
  return (
    r.exposure !== 0
    || r.brightness !== 1
    || r.contrast !== 1
    || r.saturation !== 1
    || r.hue !== 0
    || r.blur > 0
    || r.sharpen > 0
    || r.grain > 0
    || r.chromatic > 0
    || r.posterize >= 2
    || r.gradientMap !== null
    || r.shadow !== null
    || r.glow !== null
  );
}

/** Vignette is painted rather than filtered, so it is tracked separately. */
export function hasPaintedFx(fx: ArtworkLayerFx | undefined): boolean {
  return fxDefaults(fx).vignette > 0;
}

export function hasAnyFx(fx: ArtworkLayerFx | undefined): boolean {
  return hasFilterFx(fx) || hasPaintedFx(fx);
}

/* ── Colour helpers ─────────────────────────────────────────────────────── */

/** One 0..1 channel of a `#rrggbb`. Index 0=R, 1=G, 2=B. */
export function channelOf(hex: string, index: 0 | 1 | 2): number {
  const clean = hex.replace('#', '').trim();
  const full = clean.length === 3
    ? clean.split('').map((c) => c + c).join('')
    : clean;
  const value = Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);
  return Number.isFinite(value) ? value / 255 : 0;
}

function round(value: number, places = 4): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ── Filter construction ────────────────────────────────────────────────── */

/**
 * The filter region.
 *
 * SVG's default is a 10% bleed, which clips any shadow, glow or blur that
 * reaches past it — the effect looks like it has a hard rectangular edge. The
 * region is widened to cover whatever the largest spilling effect needs, in
 * percent, because `filterUnits` is `objectBoundingBox` by default and percents
 * are the only unit that means the same thing on an HTML element and an SVG
 * node alike.
 */
function filterRegion(r: ResolvedFx, referenceSize: number): { pad: number } {
  const spill = Math.max(
    r.blur * 2,
    r.glow ? r.glow.blur * 2 : 0,
    r.shadow ? Math.abs(r.shadow.x) + Math.abs(r.shadow.y) + r.shadow.blur * 2 : 0,
    r.chromatic * 2,
  );
  if (spill <= 0) return { pad: 10 };
  // Convert the spill (document units) into a percentage of the layer, then
  // give it a little headroom. Capped so a huge blur on a tiny layer does not
  // create an absurd render area.
  const percent = (spill / Math.max(1, referenceSize)) * 100;
  return { pad: clamp(Math.ceil(percent) + 10, 10, 200) };
}

type Primitive = { markup: string; result: string };

/**
 * Build the ordered primitive chain.
 *
 * Order is the conventional photographic one — tone, then colour, then optics,
 * then texture, then the light that sits outside the subject. Changing it
 * changes results, so it is deliberate rather than incidental:
 *
 *   exposure/brightness/contrast → saturation → hue → gradient map →
 *   posterize → blur → sharpen → chromatic → grain → glow → shadow
 */
function buildPrimitives(r: ResolvedFx, scale: number): Primitive[] {
  const chain: Primitive[] = [];
  let input = 'SourceGraphic';

  const push = (markup: string, result: string) => {
    chain.push({ markup, result });
    input = result;
  };

  // Exposure, brightness and contrast are all linear transfers, so they
  // collapse into a single primitive instead of three passes over the pixels.
  // out = in * (2^exposure * brightness * contrast) + (0.5 - 0.5 * contrast)
  if (r.exposure !== 0 || r.brightness !== 1 || r.contrast !== 1) {
    const slope = round(2 ** r.exposure * r.brightness * r.contrast);
    const intercept = round(0.5 - 0.5 * r.contrast);
    push(
      `<feComponentTransfer in="${input}" result="fxTone">`
      + `<feFuncR type="linear" slope="${slope}" intercept="${intercept}" />`
      + `<feFuncG type="linear" slope="${slope}" intercept="${intercept}" />`
      + `<feFuncB type="linear" slope="${slope}" intercept="${intercept}" />`
      + `</feComponentTransfer>`,
      'fxTone',
    );
  }

  if (r.saturation !== 1) {
    push(`<feColorMatrix in="${input}" type="saturate" values="${round(r.saturation)}" result="fxSat" />`, 'fxSat');
  }

  if (r.hue !== 0) {
    push(`<feColorMatrix in="${input}" type="hueRotate" values="${round(r.hue)}" result="fxHue" />`, 'fxHue');
  }

  if (r.gradientMap) {
    const { from, to, amount } = r.gradientMap;
    // Flatten to luminance, then use that as the index into a two-stop ramp.
    // `tableValues="a b"` is a linear interpolation from a to b across the
    // input range, which is exactly a two-colour gradient map.
    const mapped = 'fxMapFull';
    chain.push({
      markup:
        `<feColorMatrix in="${input}" type="saturate" values="0" result="fxMapLuma" />`
        + `<feComponentTransfer in="fxMapLuma" result="${mapped}">`
        + `<feFuncR type="table" tableValues="${round(channelOf(from, 0))} ${round(channelOf(to, 0))}" />`
        + `<feFuncG type="table" tableValues="${round(channelOf(from, 1))} ${round(channelOf(to, 1))}" />`
        + `<feFuncB type="table" tableValues="${round(channelOf(from, 2))} ${round(channelOf(to, 2))}" />`
        + `</feComponentTransfer>`,
      result: mapped,
    });
    if (amount >= 1) {
      input = mapped;
    } else {
      // Cross-fade back toward the untouched layer so the control is a dial
      // rather than a switch.
      push(
        `<feComposite in="${mapped}" in2="${input}" operator="arithmetic"`
        + ` k1="0" k2="${round(amount)}" k3="${round(1 - amount)}" k4="0" result="fxMap" />`,
        'fxMap',
      );
    }
  }

  if (r.posterize >= 2) {
    const steps = Math.round(clamp(r.posterize, 2, 32));
    // `discrete` maps the input range onto n bands. The table is the value each
    // band snaps to, evenly spaced across 0..1.
    const table = Array.from({ length: steps }, (_, i) => round(i / (steps - 1))).join(' ');
    push(
      `<feComponentTransfer in="${input}" result="fxPost">`
      + `<feFuncR type="discrete" tableValues="${table}" />`
      + `<feFuncG type="discrete" tableValues="${table}" />`
      + `<feFuncB type="discrete" tableValues="${table}" />`
      + `</feComponentTransfer>`,
      'fxPost',
    );
  }

  if (r.blur > 0) {
    push(`<feGaussianBlur in="${input}" stdDeviation="${round(r.blur * scale)}" result="fxBlur" />`, 'fxBlur');
  }

  if (r.sharpen > 0) {
    // Unsharp via a 3x3 laplacian. `preserveAlpha` keeps the kernel off the
    // alpha channel, otherwise edges grow a dark halo where the layer meets
    // transparency.
    const k = round(clamp(r.sharpen, 0, 1) * 1.6);
    const centre = round(1 + 4 * k);
    push(
      `<feConvolveMatrix in="${input}" order="3" preserveAlpha="true"`
      + ` kernelMatrix="0 ${-k} 0 ${-k} ${centre} ${-k} 0 ${-k} 0" result="fxSharp" />`,
      'fxSharp',
    );
  }

  if (r.chromatic > 0) {
    // Split the channels, push red and blue apart, then add them back
    // together. This is the real thing rather than a coloured drop shadow:
    // each channel is isolated with a matrix, offset, and recombined
    // additively so greys stay grey and only edges fringe.
    const d = round(r.chromatic * scale);
    const src = input;
    chain.push({
      markup:
        `<feOffset in="${src}" dx="${-d}" dy="0" result="fxCaRo" />`
        + `<feColorMatrix in="fxCaRo" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="fxCaR" />`
        + `<feColorMatrix in="${src}" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="fxCaG" />`
        + `<feOffset in="${src}" dx="${d}" dy="0" result="fxCaBo" />`
        + `<feColorMatrix in="fxCaBo" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="fxCaB" />`
        + `<feComposite in="fxCaR" in2="fxCaG" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="fxCaRG" />`
        + `<feComposite in="fxCaRG" in2="fxCaB" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="fxCa" />`,
      result: 'fxCa',
    });
    input = 'fxCa';
  }

  if (r.grain > 0) {
    // `baseFrequency` is a reciprocal of length, so it divides by scale where
    // every other measurement multiplies — otherwise grain gets coarser as you
    // zoom in and the export ends up finer than what you approved on screen.
    const frequency = round(0.9 / Math.max(0.0001, scale), 5);
    const amount = round(clamp(r.grain, 0, 1) * 0.55);
    chain.push({
      markup:
        `<feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="3" seed="7" result="fxNoiseRaw" />`
        + `<feColorMatrix in="fxNoiseRaw" type="saturate" values="0" result="fxNoiseFlat" />`
        // Centre the noise on mid-grey and scale it, so `overlay` lightens and
        // darkens evenly instead of only ever brightening.
        + `<feComponentTransfer in="fxNoiseFlat" result="fxNoise">`
        + `<feFuncR type="linear" slope="${amount}" intercept="${round(0.5 - amount / 2)}" />`
        + `<feFuncG type="linear" slope="${amount}" intercept="${round(0.5 - amount / 2)}" />`
        + `<feFuncB type="linear" slope="${amount}" intercept="${round(0.5 - amount / 2)}" />`
        + `<feFuncA type="linear" slope="0" intercept="1" />`
        + `</feComponentTransfer>`
        + `<feBlend in="${input}" in2="fxNoise" mode="overlay" result="fxGrainBlend" />`
        // Grain must not leak outside the layer's own silhouette; clip it back
        // to the source alpha or a rotated layer grows a grey rectangle.
        + `<feComposite in="fxGrainBlend" in2="${input}" operator="in" result="fxGrain" />`,
      result: 'fxGrain',
    });
    input = 'fxGrain';
  }

  if (r.glow) {
    const g = r.glow;
    chain.push({
      markup:
        `<feGaussianBlur in="${input}" stdDeviation="${round(g.blur * scale)}" result="fxGlowBlur" />`
        + `<feFlood flood-color="${g.color}" flood-opacity="${round(g.opacity)}" result="fxGlowColor" />`
        + `<feComposite in="fxGlowColor" in2="fxGlowBlur" operator="in" result="fxGlowShape" />`
        + `<feMerge result="fxGlow"><feMergeNode in="fxGlowShape" /><feMergeNode in="${input}" /></feMerge>`,
      result: 'fxGlow',
    });
    input = 'fxGlow';
  }

  if (r.shadow) {
    const s = r.shadow;
    push(
      `<feDropShadow in="${input}" dx="${round(s.x * scale)}" dy="${round(s.y * scale)}"`
      + ` stdDeviation="${round(s.blur * scale)}" flood-color="${s.color}"`
      + ` flood-opacity="${round(s.opacity)}" result="fxShadow" />`,
      'fxShadow',
    );
  }

  return chain;
}

/**
 * The `<filter>` element for a layer, or an empty string when it needs none.
 *
 * `id` must be unique within the document that hosts it. `scale` converts
 * document units into the host's units — the canvas passes its zoom, the
 * exporter passes 1. `referenceSize` is the layer's smaller dimension, used
 * only to size the render region.
 */
export function buildFxFilterDef(
  fx: ArtworkLayerFx | undefined,
  id: string,
  scale: number,
  referenceSize: number,
): string {
  if (!hasFilterFx(fx)) return '';
  const resolved = fxDefaults(fx);
  const { pad } = filterRegion(resolved, referenceSize);
  const primitives = buildPrimitives(resolved, scale).map((p) => p.markup).join('');
  return `<filter id="${id}" x="${-pad}%" y="${-pad}%" width="${100 + pad * 2}%" height="${100 + pad * 2}%"`
    + ` color-interpolation-filters="sRGB">${primitives}</filter>`;
}

/** `url(#id)` reference, or undefined when the layer has no filter. */
export function fxFilterRef(fx: ArtworkLayerFx | undefined, id: string): string | undefined {
  return hasFilterFx(fx) ? `url(#${id})` : undefined;
}

/**
 * The vignette overlay's gradient.
 *
 * Vignette is the one effect that is painted rather than filtered. SVG filters
 * have no primitive that produces a radial ramp without pulling in `feImage`
 * and a nested data URI, which is fragile inside an SVG that is itself being
 * rasterised through `new Image()`. A radial gradient drawn over the layer is
 * both simpler and identical in the two renderers, so it stays a paint.
 */
export function vignetteStops(amount: number): { inner: number; outerOpacity: number } {
  const a = clamp(amount, 0, 1);
  return {
    // Stronger vignettes start closer to the centre as well as going darker.
    inner: round(62 - a * 28),
    outerOpacity: round(a * 0.92),
  };
}

/** CSS `radial-gradient` for the canvas overlay. */
export function vignetteCssGradient(amount: number): string {
  const { inner, outerOpacity } = vignetteStops(amount);
  return `radial-gradient(ellipse at center, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${outerOpacity}) 100%)`;
}

/** SVG `<radialGradient>` def for the export overlay. */
export function vignetteSvgGradientDef(amount: number, id: string): string {
  const { inner, outerOpacity } = vignetteStops(amount);
  return `<radialGradient id="${id}" cx="50%" cy="50%" r="72%">`
    + `<stop offset="${inner}%" stop-color="#000000" stop-opacity="0" />`
    + `<stop offset="100%" stop-color="#000000" stop-opacity="${outerOpacity}" />`
    + `</radialGradient>`;
}

/* ── Presets ────────────────────────────────────────────────────────────── */

export type FxPreset = {
  id: string;
  name: string;
  hint: string;
  fx: ArtworkLayerFx;
};

/**
 * Curated starting points.
 *
 * The brief for this studio is "curated, not a gimmicky effects menu", so these
 * are looks a producer would actually reach for, each one a plain `fx` object
 * they can then take apart in the inspector. Nothing here is special-cased —
 * a preset is just a value.
 */
export const fxPresets: FxPreset[] = [
  {
    id: 'clean',
    name: 'Clean',
    hint: 'Reset every adjustment',
    fx: {},
  },
  {
    id: 'film',
    name: 'Film',
    hint: 'Lifted blacks, soft grain',
    fx: { contrast: 0.92, saturation: 0.88, exposure: 0.08, grain: 0.34, vignette: 0.22 },
  },
  {
    id: 'print',
    name: 'Print',
    hint: 'Hard contrast, posterised',
    fx: { contrast: 1.45, saturation: 0.2, posterize: 6, grain: 0.18 },
  },
  {
    id: 'bleach',
    name: 'Bleach',
    hint: 'Washed highlights',
    fx: { exposure: 0.35, contrast: 1.18, saturation: 0.25 },
  },
  {
    id: 'vhs',
    name: 'VHS',
    hint: 'Channel split and noise',
    fx: { chromatic: 7, grain: 0.42, saturation: 1.2, contrast: 1.08 },
  },
  {
    id: 'nocturne',
    name: 'Nocturne',
    hint: 'Crushed, cold, vignetted',
    fx: { exposure: -0.3, contrast: 1.3, saturation: 0.55, hue: -12, vignette: 0.5 },
  },
  {
    id: 'bloom',
    name: 'Bloom',
    hint: 'Soft glow around the subject',
    fx: { glow: { blur: 26, color: '#F2F2F0', opacity: 0.45 }, exposure: 0.12, contrast: 0.95 },
  },
  {
    id: 'mineral',
    name: 'Mineral',
    hint: 'Two-tone gradient map',
    fx: { gradientMap: { from: '#0C0C0A', to: '#C8A47A', amount: 0.9 }, contrast: 1.1 },
  },
];

/** Look up a preset by id. Unknown ids resolve to neutral rather than throwing. */
export function fxPresetById(id: string): ArtworkLayerFx {
  return fxPresets.find((preset) => preset.id === id)?.fx ?? {};
}
