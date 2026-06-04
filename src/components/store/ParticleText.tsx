'use client';

/**
 * ParticleText — canvas-rendered text composed of small particles that
 * assemble on mount and repel from the cursor while the user hovers.
 *
 * Implementation notes:
 *   - Particles are sampled from an offscreen text raster (one particle
 *     per pixel above an alpha threshold, then thinned by a stride).
 *   - Mount animation: each particle starts at a random position and
 *     eases toward its target over ~1.2s.
 *   - Hover repulsion: cursor within 80px pushes each particle along
 *     the gradient; a spring eases it back when the cursor leaves.
 *   - `prefers-reduced-motion`: skips the assembly animation AND the
 *     hover repulsion. Particles render statically in final position.
 *   - Canvas is transparent — the hero background underneath shows
 *     through unchanged.
 */

import { useEffect, useRef } from 'react';

interface Particle {
  x: number;        // current
  y: number;
  tx: number;       // target
  ty: number;
  vx: number;       // velocity
  vy: number;
  size: number;
  alpha: number;
}

interface ParticleTextProps {
  text: string;
  /** Defaults to the antigravity accent #D4BFA0. */
  color?: string;
  /** Pass-through className for the wrapping <div>. */
  className?: string;
}

export function ParticleText({ text, color = '#D4BFA0', className }: ParticleTextProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const dpr = window.devicePixelRatio || 1;
    let particles: Particle[] = [];
    let raf = 0;
    const mouse = { x: -1, y: -1, active: false };
    const startTime = performance.now();
    const ASSEMBLY_MS = 1200;

    function rebuild() {
      if (!canvas || !ctx || !wrap) return;
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.scale(dpr, dpr);

      // Rasterise the text onto an offscreen canvas so we can sample pixels.
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const octx = off.getContext('2d');
      if (!octx) return;

      // Font size: 70% of container height, capped so wide containers
      // don't blow it up beyond legible.
      const fontSize = Math.min(h * 0.72, w / Math.max(text.length * 0.6, 1));
      octx.fillStyle = '#ffffff';
      octx.textBaseline = 'middle';
      octx.textAlign = 'center';
      // Match the app's primary font for the text shape sampling.
      octx.font = `800 ${fontSize}px "Akira Expanded", "Synkopy", system-ui, sans-serif`;
      octx.fillText(text, w / 2, h / 2);

      const imgData = octx.getImageData(0, 0, w, h).data;
      const stride = Math.max(2, Math.floor(fontSize / 24)); // density vs font scale

      const next: Particle[] = [];
      for (let y = 0; y < h; y += stride) {
        for (let x = 0; x < w; x += stride) {
          const i = (y * w + x) * 4 + 3; // alpha channel
          if (imgData[i] > 128) {
            next.push({
              x: reducedMotion ? x : Math.random() * w,
              y: reducedMotion ? y : Math.random() * h,
              tx: x,
              ty: y,
              vx: 0,
              vy: 0,
              size: 1 + Math.random() * 2,
              alpha: 0.3 + Math.random() * 0.7,
            });
          }
        }
      }
      particles = next;
    }

    function frame(now: number) {
      if (!ctx || !canvas) return;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      const t = reducedMotion ? 1 : Math.min(1, (now - startTime) / ASSEMBLY_MS);
      // easeOutCubic for the assembly
      const eased = 1 - Math.pow(1 - t, 3);

      for (const p of particles) {
        let targetX = p.tx;
        let targetY = p.ty;

        // Hover repulsion — push particles away from cursor within 80px.
        if (!reducedMotion && mouse.active) {
          const dx = p.tx - mouse.x;
          const dy = p.ty - mouse.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 80 && dist > 0.01) {
            const push = (80 - dist) / 80; // 0..1
            targetX = p.tx + (dx / dist) * push * 30;
            targetY = p.ty + (dy / dist) * push * 30;
          }
        }

        if (reducedMotion) {
          p.x = targetX;
          p.y = targetY;
        } else if (t < 1) {
          // Assembly phase — interpolate from random start to target.
          p.x = p.x + (p.tx - p.x) * eased * 0.18;
          p.y = p.y + (p.ty - p.y) * eased * 0.18;
        } else {
          // Spring toward (possibly repelled) target.
          p.vx += (targetX - p.x) * 0.12;
          p.vy += (targetY - p.y) * 0.12;
          p.vx *= 0.78;
          p.vy *= 0.78;
          p.x += p.vx;
          p.y += p.vy;
        }

        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(frame);
    }

    rebuild();
    raf = requestAnimationFrame(frame);

    // Custom fonts (Akira Expanded) may not be loaded when the component
    // mounts. If the font isn't ready, canvas text rasterisation uses a
    // fallback glyph — particles end up at the wrong positions and the
    // name appears blank. Wait for document.fonts.ready and rebuild once
    // fonts are confirmed loaded.
    let fontRebuildDone = false;
    document.fonts.ready.then(() => {
      if (!fontRebuildDone) {
        fontRebuildDone = true;
        rebuild();
      }
    });

    const onResize = () => rebuild();
    const onMove = (e: MouseEvent) => {
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.active = true;
    };
    const onLeave = () => {
      mouse.active = false;
    };

    window.addEventListener('resize', onResize);
    wrap.addEventListener('mousemove', onMove);
    wrap.addEventListener('mouseleave', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      wrap.removeEventListener('mousemove', onMove);
      wrap.removeEventListener('mouseleave', onLeave);
    };
  }, [text, color]);

  return (
    <div
      ref={wrapRef}
      className={className ?? 'relative w-full h-[80px] md:h-[120px]'}
      aria-label={text}
      role="img"
    >
      <canvas ref={canvasRef} className="block w-full h-full" />
    </div>
  );
}
