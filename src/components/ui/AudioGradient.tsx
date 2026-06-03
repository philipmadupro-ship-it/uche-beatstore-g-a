'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

interface AudioGradientProps {
  analyserNode: AnalyserNode | null;
  /** accent color from creator_profile or default #D4BFA0 */
  accentColor?: string;
  className?: string;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function averageBins(data: Uint8Array, start: number, end: number) {
  const safeEnd = Math.min(end, data.length);
  if (safeEnd <= start) return 0;

  let total = 0;
  for (let i = start; i < safeEnd; i += 1) total += data[i] ?? 0;
  return total / (safeEnd - start) / 255;
}

function hexToRgb(hex: string) {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((c) => c + c).join('')
    : normalized;
  const parsed = Number.parseInt(value, 16);

  if (!Number.isFinite(parsed)) return { r: 212, g: 191, b: 160 };
  return {
    r: (parsed >> 16) & 255,
    g: (parsed >> 8) & 255,
    b: parsed & 255,
  };
}

export function AudioGradient({
  analyserNode,
  accentColor = '#D4BFA0',
  className,
}: AudioGradientProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!analyserNode) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let frame = 0;
    let cancelled = false;
    const accent = hexToRgb(accentColor);
    const dataArray = new Uint8Array(analyserNode.frequencyBinCount);

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      analyserNode.getByteFrequencyData(dataArray);
      const bassEnergy = averageBins(dataArray, 0, 10);
      const midEnergy = averageBins(dataArray, 10, 100);

      ctx.clearRect(0, 0, width, height);

      const radius = Math.max(width, height) * 0.75;
      const radial = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, radius);
      radial.addColorStop(0, `rgba(${accent.r},${accent.g},${accent.b},${bassEnergy * 0.6})`);
      radial.addColorStop(0.45, 'rgba(0,0,0,0)');
      radial.addColorStop(1, `rgba(10,9,7,${0.4 + (1 - midEnergy) * 0.4})`);
      ctx.fillStyle = radial;
      ctx.fillRect(0, 0, width, height);

      const linear = ctx.createLinearGradient(0, 0, 0, height);
      linear.addColorStop(0, 'rgba(0,0,0,0)');
      linear.addColorStop(1, `rgba(10,9,7,${0.7 + bassEnergy * 0.3})`);
      ctx.fillStyle = linear;
      ctx.fillRect(0, 0, width, height);
    };

    const animate = () => {
      if (cancelled) return;
      draw();
      frame = window.requestAnimationFrame(animate);
    };

    draw();
    if (!prefersReducedMotion()) frame = window.requestAnimationFrame(animate);

    return () => {
      cancelled = true;
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [accentColor, analyserNode]);

  if (!analyserNode) {
    return (
      <div
        aria-hidden="true"
        className={cn('absolute inset-0 bg-[linear-gradient(to_bottom,transparent,#0a0907_80%)]', className)}
      />
    );
  }

  return <canvas ref={canvasRef} aria-hidden="true" className={cn('absolute inset-0', className)} />;
}
