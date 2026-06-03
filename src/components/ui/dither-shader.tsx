'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type DitherMode = 'bayer' | 'halftone' | 'noise' | 'crosshatch';
export type DitherColorMode = 'original' | 'grayscale' | 'duotone';
export type DitherTexture = 'paper' | 'film-grain' | 'concrete' | 'scanlines' | 'none';

export interface DitherShaderProps {
  src: string;
  alt?: string;
  className?: string;
  mode?: DitherMode;
  colorMode?: DitherColorMode;
  gridSize?: number;
  detail?: number;
  threshold?: number;
  brightness?: number;
  texture?: DitherTexture;
  reactivity?: number;
  analyserNode?: AnalyserNode | null;
}

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
] as const;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function averageBins(data: Uint8Array<ArrayBuffer>, start: number, end: number) {
  const safeEnd = Math.min(end, data.length);
  if (safeEnd <= start) return 0;

  let total = 0;
  for (let i = start; i < safeEnd; i += 1) total += data[i] ?? 0;
  return total / (safeEnd - start) / 255;
}

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

interface AudioReactiveState {
  bass: number;
  mid: number;
  high: number;
  kick: number;
  phase: number;
}

function stableNoise(x: number, y: number, seed = 0) {
  return ((Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453) % 1 + 1) % 1;
}

function textureBias(
  texture: DitherTexture,
  x: number,
  y: number,
  step: number,
  audio: AudioReactiveState,
  reactivity: number,
) {
  if (texture === 'none') return 0;

  if (texture === 'film-grain') {
    return (stableNoise(x + audio.phase * 9, y, 2) - 0.5) * (0.18 + audio.high * 0.18 * reactivity);
  }

  if (texture === 'scanlines') {
    return Math.sin((y + audio.phase * 18 * reactivity) / Math.max(1, step) * Math.PI) * (0.1 + audio.high * 0.16 * reactivity);
  }

  if (texture === 'concrete') {
    const coarse = stableNoise(Math.floor((x + audio.kick * 20 * reactivity) / (step * 3)), Math.floor(y / (step * 3)), 4);
    const fine = stableNoise(x + audio.phase * 4, y, 5);
    const scratch = Math.abs(Math.sin((x - y + audio.phase * 12) / Math.max(1, step * 4))) > 0.96 ? -0.18 : 0;
    return (coarse - 0.5) * 0.16 + (fine - 0.5) * 0.08 + scratch;
  }

  const fiberA = Math.sin((x + stableNoise(y, x, 7) * 8 + audio.mid * 12 * reactivity) / Math.max(1, step * 2.2));
  const fiberB = Math.sin((y + stableNoise(x, y, 8) * 8 + audio.high * 10 * reactivity) / Math.max(1, step * 2.8));
  return (fiberA + fiberB) * (0.045 + audio.mid * 0.04 * reactivity) + (stableNoise(x + audio.phase, y, 9) - 0.5) * 0.08;
}

function proxiedImageSrc(src: string) {
  if (typeof window === 'undefined') return src;
  try {
    const parsed = new URL(src, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.toString();
    return `/api/store/image-proxy?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return src;
  }
}

function applyDithering(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  mode: DitherMode,
  colorMode: DitherColorMode,
  texture: DitherTexture,
  gridSize: number,
  detail: number,
  threshold: number,
  brightness: number,
  audio: AudioReactiveState,
  reactivity: number,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(image, 0, 0, width, height);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return;
  }

  const data = imageData.data;
  const adaptiveCell = Math.max(1, Math.round(Math.min(width, height) / Math.max(96, detail * 120)));
  const step = Math.max(1, Math.round(gridSize * dpr * adaptiveCell));
  const normalizedThreshold = Math.max(0, Math.min(1, threshold));
  const kickShift = Math.round(audio.kick * step * 4 * reactivity);
  const midWarp = audio.mid * step * 2.5 * reactivity;
  const highSparkle = audio.high * 0.32 * reactivity;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const rowWave = Math.sin(y / Math.max(1, step * 5) + audio.phase * 0.08) * midWarp;
      const blockKick = Math.sin(y / Math.max(1, step * 3) + audio.phase * 0.2) > 0.72 ? kickShift : 0;
      const sampleX = Math.max(0, Math.min(width - 1, Math.round(x + rowWave + blockKick)));
      const sampleY = Math.max(0, Math.min(height - 1, Math.round(y + Math.sin(x / Math.max(1, step * 6) + audio.phase * 0.06) * audio.bass * step * reactivity)));
      const index = (sampleY * width + sampleX) * 4;
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      const luminance = ((r * 0.299 + g * 0.587 + b * 0.114) / 255) * brightness;

      const bx = Math.floor(x / step) % 4;
      const by = Math.floor(y / step) % 4;
      const bayerValue = ((BAYER_4X4[by]?.[bx] ?? 0) + 0.5) / 16;
      const noiseValue = stableNoise(x + audio.phase * (2 + audio.high * 20), y, 1);
      const halftoneRadius = step * (1.4 + audio.bass * 0.8 * reactivity);
      const halftoneValue = Math.hypot((x % (step * 2)) - step, (y % (step * 2)) - step) / halftoneRadius;
      const crossSpacing = step * (3 + audio.bass * 1.5 * reactivity);
      const crossValue = (x + y + audio.phase * 3) % crossSpacing < step || Math.abs(x - y + audio.phase * 2) % crossSpacing < step ? 0.35 : 0.75;
      const materialBias = textureBias(texture, x, y, step, audio, reactivity);

      const pattern =
        mode === 'noise'
          ? noiseValue
          : mode === 'halftone'
            ? halftoneValue
            : mode === 'crosshatch'
              ? crossValue
              : bayerValue;

      const fieldPulse = Math.sin((x + y) / Math.max(1, step * 7) + audio.phase * 0.1) * audio.mid * 0.12 * reactivity;
      const sparkle = stableNoise(x + audio.phase * 31, y - audio.phase * 17, 12) < highSparkle ? 0.3 : 0;
      const active = luminance + pattern * 0.35 + materialBias + fieldPulse + sparkle > normalizedThreshold;
      let nr = active ? r : r * 0.14;
      let ng = active ? g : g * 0.14;
      let nb = active ? b : b * 0.14;

      const materialLift = texture === 'none' ? 0 : materialBias * 70 + audio.high * 18 * reactivity;

      if (colorMode === 'grayscale') {
        const gray = active ? luminance * 255 : luminance * 55;
        nr = gray;
        ng = gray;
        nb = gray;
      } else if (colorMode === 'duotone') {
        nr = active ? 212 + audio.high * 20 * reactivity : 10 + audio.bass * 20 * reactivity;
        ng = active ? 191 + audio.mid * 15 * reactivity : 9;
        nb = active ? 160 + audio.bass * 22 * reactivity : 7 + audio.kick * 30 * reactivity;
      }

      for (let yy = y; yy < Math.min(y + step, height); yy += 1) {
        for (let xx = x; xx < Math.min(x + step, width); xx += 1) {
          const out = (yy * width + xx) * 4;
          data[out] = clampByte(nr + materialLift);
          data[out + 1] = clampByte(ng + materialLift);
          data[out + 2] = clampByte(nb + materialLift);
          data[out + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

export function DitherShader({
  src,
  alt = 'Dithered cover art',
  className,
  mode = 'bayer',
  colorMode = 'original',
  gridSize = 4,
  detail = 1.1,
  threshold = 0.5,
  brightness = 1,
  texture = 'paper',
  reactivity = 1,
  analyserNode,
}: DitherShaderProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frequencyDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const audioStateRef = useRef<AudioReactiveState>({ bass: 0, mid: 0, high: 0, kick: 0, phase: 0 });
  const lastBassRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let frame = 0;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.decoding = 'async';
    image.src = proxiedImageSrc(src);
    imageRef.current = image;

    const render = () => {
      if (!canvas || !imageRef.current) return;

      let effectiveGridSize = gridSize;
      let effectiveThreshold = threshold;
      let effectiveBrightness = brightness;
      let audio = audioStateRef.current;

      if (analyserNode) {
        if (!frequencyDataRef.current || frequencyDataRef.current.length !== analyserNode.frequencyBinCount) {
          frequencyDataRef.current = new Uint8Array(analyserNode.frequencyBinCount);
        }
        const dataArray = frequencyDataRef.current;
        analyserNode.getByteFrequencyData(dataArray);
        const bassEnergy = averageBins(dataArray, 0, 10);
        const midEnergy = averageBins(dataArray, 10, 100);
        const highEnergy = averageBins(dataArray, 100, 255);
        const kick = Math.max(0, bassEnergy - lastBassRef.current) * 4;
        lastBassRef.current = bassEnergy;

        audio = {
          bass: audio.bass * 0.72 + bassEnergy * 0.28,
          mid: audio.mid * 0.78 + midEnergy * 0.22,
          high: audio.high * 0.68 + highEnergy * 0.32,
          kick: audio.kick * 0.55 + Math.min(1, kick) * 0.45,
          phase: audio.phase + 1 + bassEnergy * 4 + highEnergy * 2,
        };
        audioStateRef.current = audio;

        effectiveGridSize = gridSize + audio.bass * 8 * reactivity + audio.kick * 5 * reactivity;
        effectiveThreshold = threshold + (audio.mid - 0.5) * 0.36 * reactivity - audio.kick * 0.12 * reactivity;
        effectiveBrightness = brightness + audio.high * 0.22 * reactivity + audio.kick * 0.08 * reactivity;
      } else {
        audioStateRef.current = { bass: 0, mid: 0, high: 0, kick: 0, phase: 0 };
        lastBassRef.current = 0;
        audio = audioStateRef.current;
      }

      applyDithering(
        canvas,
        imageRef.current,
        mode,
        colorMode,
        texture,
        effectiveGridSize,
        detail,
        effectiveThreshold,
        effectiveBrightness,
        audio,
        reactivity,
      );
    };

    const animate = () => {
      if (cancelled) return;
      render();
      frame = window.requestAnimationFrame(animate);
    };

    image.onload = () => {
      render();
      if (analyserNode && !prefersReducedMotion()) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [analyserNode, brightness, colorMode, detail, gridSize, mode, reactivity, src, texture, threshold]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Dithered image"
      role="img"
      title={alt}
      className={cn('h-full w-full object-cover', className)}
    />
  );
}
