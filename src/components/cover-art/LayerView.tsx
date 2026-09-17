'use client';

/**
 * Renders one artwork layer on the editing canvas.
 *
 * This is the half of the studio that was broken: the previous canvas drew
 * every image layer as a grey placeholder box and never read `layer.src`, so an
 * uploaded or generated cover was invisible until you exported it. Everything
 * here is deliberately kept in step with `renderArtworkDocumentSvg` — the same
 * crop maths (`imageFrameRect`), the same fit modes, the same masks — because
 * a canvas that disagrees with the export is worse than no canvas.
 */

import { ImageIcon } from 'lucide-react';
import {
  imageCropDefaults,
  imageFrameRect,
  textWeightFor,
  waveformDefaults,
  waveformSeriesFor,
  type ArtworkLayer,
  type ArtworkTextureKind,
  type ImageArtworkLayer,
  type WaveformArtworkLayer,
  type ArtworkPalette,
} from './cover-art-document';
import {
  barRect, barSlots, capRadius, circularSegments, pointsAttribute, waveformPathPoints,
} from '@/lib/cover/waveform';
import { fontStackFor } from '@/lib/cover/fonts';
import {
  flattenForPath, textPathD, textPathDefaults, textPathPlacement,
} from '@/lib/cover/text-path';

/** CSS `filter` matching each SVG treatment filter, so preview equals export. */
function treatmentFilter(layer: ImageArtworkLayer, palette: ArtworkPalette): string | undefined {
  switch (layer.treatment) {
    case 'grayscale': return 'grayscale(1)';
    case 'high-contrast': return 'contrast(1.6) brightness(0.95)';
    case 'mineral-tint': return 'saturate(0.35)';
    case 'bleach': return 'saturate(0.15) brightness(1.12)';
    case 'duotone': return 'grayscale(1) contrast(1.1)';
    default: return undefined;
  }
}

/** Non-rectangular crops. Mirrors `imageClipShape` in the document renderer. */
function maskClipPath(mask: ImageArtworkLayer['mask']): string | undefined {
  if (mask === 'circle') return 'ellipse(50% 50% at 50% 50%)';
  if (mask === 'diamond') return 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)';
  if (mask === 'arch') return 'polygon(0% 100%, 0% 50%, 10% 22%, 30% 6%, 50% 0%, 70% 6%, 90% 22%, 100% 50%, 100% 100%)';
  return undefined;
}

/** CSS approximations of the SVG texture patterns. */
export function textureBackground(texture: ArtworkTextureKind, scale: number): {
  backgroundImage: string;
  backgroundSize: string;
} {
  const px = (value: number) => `${Math.max(2, value * scale)}px`;
  switch (texture) {
    case 'basalt-noise':
      return {
        backgroundImage:
          'radial-gradient(circle at 15% 24%, rgba(255,255,255,.22) 1px, transparent 2px),'
          + 'radial-gradient(circle at 68% 12%, rgba(255,255,255,.16) 1px, transparent 2px),'
          + 'radial-gradient(circle at 45% 63%, rgba(255,255,255,.24) 2px, transparent 3px),'
          + 'radial-gradient(circle at 87% 82%, rgba(255,255,255,.18) 1px, transparent 2px)',
        backgroundSize: `${px(60)} ${px(60)}`,
      };
    case 'scan-grain':
      return {
        backgroundImage: 'repeating-linear-gradient(0deg, rgba(255,255,255,.12) 0 1px, transparent 1px 3px)',
        backgroundSize: `100% ${px(6)}`,
      };
    case 'halftone':
      return {
        backgroundImage: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,.28) 30%, transparent 31%),'
          + 'radial-gradient(circle at 75% 75%, rgba(255,255,255,.28) 30%, transparent 31%)',
        backgroundSize: `${px(16)} ${px(16)}`,
      };
    case 'crosshatch':
      return {
        backgroundImage: 'repeating-linear-gradient(45deg, rgba(255,255,255,.20) 0 1px, transparent 1px 14px),'
          + 'repeating-linear-gradient(-45deg, rgba(255,255,255,.20) 0 1px, transparent 1px 14px)',
        backgroundSize: `${px(14)} ${px(14)}`,
      };
    case 'vignette':
      return {
        backgroundImage: 'radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,.85) 100%)',
        backgroundSize: '100% 100%',
      };
    default:
      return {
        backgroundImage:
          'linear-gradient(0deg, rgba(255,255,255,.08) 1px, transparent 1px),'
          + 'linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px)',
        backgroundSize: `${px(42)} ${px(42)}`,
      };
  }
}

/**
 * Canvas waveform.
 *
 * Draws from the same `waveformSeriesFor` and the same geometry helpers the SVG
 * exporter uses, so what you position on screen is what lands in the file. It
 * renders as an SVG with a viewBox in document units rather than DOM elements,
 * which means zooming is a pure scale and bars never drift out of step with the
 * artboard.
 */
function WaveformGraphic({ layer }: { layer: WaveformArtworkLayer }) {
  const { barGap, cap, mirror } = waveformDefaults(layer);
  const values = waveformSeriesFor(layer);

  if (layer.mode === 'circular') {
    const size = Math.min(layer.width, layer.height);
    return (
      <svg
        viewBox={`0 0 ${layer.width} ${layer.height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        <g transform={`translate(${(layer.width - size) / 2} ${(layer.height - size) / 2})`}>
          {circularSegments(values, size).map((segment, index) => (
            <line
              key={index}
              x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2}
              stroke={layer.color}
              strokeWidth={Math.max(1, layer.strokeWidth / 3)}
              strokeLinecap={cap === 'round' ? 'round' : 'butt'}
            />
          ))}
        </g>
      </svg>
    );
  }

  if (layer.mode === 'contour') {
    return (
      <svg viewBox={`0 0 ${layer.width} ${layer.height}`} preserveAspectRatio="none" className="h-full w-full">
        <polygon points={pointsAttribute(waveformPathPoints(values, layer.width, layer.height, true))} fill={layer.color} />
      </svg>
    );
  }

  if (layer.mode === 'line') {
    return (
      <svg viewBox={`0 0 ${layer.width} ${layer.height}`} preserveAspectRatio="none" className="h-full w-full">
        <polyline
          points={pointsAttribute(waveformPathPoints(values, layer.width, layer.height, false))}
          fill="none"
          stroke={layer.color}
          strokeWidth={Math.max(1, layer.strokeWidth / 2)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const blocks = layer.mode === 'blocks';
  const slots = barSlots(layer.width, values.length, blocks ? 0.08 : barGap);
  return (
    <svg viewBox={`0 0 ${layer.width} ${layer.height}`} preserveAspectRatio="none" className="h-full w-full">
      {slots.map((slot, index) => {
        const rect = barRect(slot, values[index], layer.height, mirror);
        const radius = blocks ? 0 : capRadius(rect, cap);
        return (
          <rect
            key={index}
            x={rect.x} y={rect.y} width={rect.width} height={rect.height}
            rx={radius} ry={radius}
            fill={layer.color}
          />
        );
      })}
    </svg>
  );
}

export function LayerView({
  layer,
  zoom,
  palette,
  editing,
  onEditDone,
  onUpdateText,
}: {
  layer: ArtworkLayer;
  zoom: number;
  palette: ArtworkPalette;
  editing?: boolean;
  onEditDone?: () => void;
  onUpdateText?: (text: string) => void;
}) {
  // A group draws nothing itself — `StudioCanvas` nests its children inside a
  // wrapper that carries the group's opacity and blend. Returning null here
  // rather than handling groups is what keeps this component about CONTENT.
  if (layer.type === 'group') return null;

  if (layer.type === 'shape') {
    if (layer.shape === 'triangle') {
      return (
        <div
          className="h-full w-full"
          style={{
            background: layer.fill,
            clipPath: 'polygon(50% 0%, 100% 100%, 0% 100%)',
          }}
        />
      );
    }
    return (
      <div
        className="h-full w-full"
        style={{
          background: layer.fill,
          border: layer.stroke ? `${(layer.strokeWidth ?? 1) * zoom}px solid ${layer.stroke}` : undefined,
          borderRadius: layer.shape === 'circle' ? '999px' : (layer.cornerRadius ?? 0) * zoom,
        }}
      />
    );
  }

  if (layer.type === 'image') {
    const { fit, mask, radius } = imageCropDefaults(layer);
    if (!layer.src) {
      return (
        <div className="grid h-full w-full place-items-center border border-dashed border-white/20 bg-[#0D0D0A] text-center text-white/40">
          <span className="grid place-items-center gap-1">
            <ImageIcon size={Math.max(16, 60 * zoom)} />
            <span className="px-2 text-[10px] uppercase tracking-[0.14em]">Drop an image</span>
          </span>
        </div>
      );
    }
    const rect = imageFrameRect(layer);
    return (
      <div
        className="relative h-full w-full overflow-hidden"
        style={{ borderRadius: radius * zoom, clipPath: maskClipPath(mask) }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- data: and R2 URLs, sized by the document not the layout; next/image cannot serve either here. */}
        <img
          src={layer.src}
          alt=""
          draggable={false}
          className="absolute max-w-none select-none"
          style={{
            left: rect.x * zoom,
            top: rect.y * zoom,
            width: rect.width * zoom,
            height: rect.height * zoom,
            objectFit: fit,
            filter: treatmentFilter(layer, palette),
          }}
        />
        {layer.treatment === 'duotone' ? (
          // Approximates the SVG duotone filter: the greyscale plate above is
          // tinted by mixing the palette's two ends over it.
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(0deg, ${palette.background}, ${palette.accent})`,
              mixBlendMode: 'color',
            }}
          />
        ) : null}
      </div>
    );
  }

  if (layer.type === 'waveform') {
    return <WaveformGraphic layer={layer} />;
  }

  if (layer.type === 'texture') {
    const texture = textureBackground(layer.texture, zoom);
    return <div className="h-full w-full" style={{ opacity: layer.intensity, ...texture }} />;
  }

  const text = layer.uppercase ? layer.text.toUpperCase() : layer.text;
  const typeStyle = {
    color: layer.color,
    fontFamily: fontStackFor(layer.fontFamily),
    // Both renderers go through `textWeightFor`. Setting no weight here at all
    // — which is what this did — while the exporter hardcoded 700 meant the
    // canvas drew Synkopy Regular and the file asked for a bold that only
    // exists as the Flipside cut on the page and as a synthesised fake inside
    // an exported SVG. Three different results for one layer.
    fontWeight: textWeightFor(layer),
    fontSize: layer.fontSize * zoom,
    letterSpacing: layer.tracking * zoom,
    lineHeight: layer.lineHeight,
    textAlign: layer.align,
    WebkitTextStrokeWidth: layer.stroke && (layer.strokeWidth ?? 0) > 0 ? (layer.strokeWidth ?? 0) * zoom : undefined,
    WebkitTextStrokeColor: layer.stroke,
  } as const;

  if (editing) {
    return (
      <textarea
        autoFocus
        defaultValue={layer.text}
        onBlur={(event) => {
          onUpdateText?.(event.target.value);
          onEditDone?.();
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') onEditDone?.();
        }}
        className="h-full w-full resize-none bg-[#090907]/90 p-1 outline outline-1 outline-[#F2F2F0]"
        style={typeStyle}
      />
    );
  }

  /**
   * Type on a curve.
   *
   * Rendered as an inline SVG in DOCUMENT units, the same trick the waveform
   * layers use: the viewBox absorbs the zoom, so the path and the font size are
   * the raw layer values and this element receives byte-for-byte the same `d`
   * string the exporter writes. There is no DOM equivalent of `<textPath>` to
   * approximate, and no approximation to drift.
   */
  const curve = textPathD(textPathDefaults(layer.path), layer.width, layer.height);
  if (curve) {
    const place = textPathPlacement(layer.align);
    const outlined = Boolean(layer.stroke) && (layer.strokeWidth ?? 0) > 0;
    return (
      <svg
        viewBox={`0 0 ${layer.width} ${layer.height}`}
        preserveAspectRatio="none"
        className="h-full w-full overflow-visible"
      >
        <defs>
          {/* Prefixed differently from the exporter's `tp-`, so a canvas def
              and an export def can never collide in one document. */}
          <path id={`tpc-${layer.id}`} d={curve} fill="none" />
        </defs>
        <text
          textAnchor={place.anchor}
          fill={layer.color}
          fontSize={layer.fontSize}
          fontFamily={fontStackFor(layer.fontFamily)}
          fontWeight={textWeightFor(layer)}
          letterSpacing={layer.tracking}
          stroke={outlined ? layer.stroke : undefined}
          strokeWidth={outlined ? layer.strokeWidth : undefined}
          paintOrder={outlined ? 'stroke' : undefined}
        >
          <textPath href={`#tpc-${layer.id}`} startOffset={place.startOffset}>
            {flattenForPath(text)}
          </textPath>
        </text>
      </svg>
    );
  }

  return (
    <div
      className="h-full w-full overflow-hidden whitespace-pre-wrap break-words"
      style={{ ...typeStyle, textTransform: layer.uppercase ? 'uppercase' : 'none' }}
    >
      {text}
    </div>
  );
}
