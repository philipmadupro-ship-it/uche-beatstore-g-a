'use client';

/**
 * The signing box (LABEL-60), shared by the member's panel and the external
 * signer's page: the full name typed, optionally drawn as well, and one button.
 * A typed name is always required and is what the signature is recorded under;
 * a drawing is an addition kept as a PNG in the private bucket. The canvas is
 * a plain pointer-event drawing surface (mouse, touch and pen through the same
 * handlers), `touch-action: none` so a finger draws instead of scrolling.
 */
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const LABEL = 'text-[10px] font-mono uppercase tracking-[0.2em] text-white/40';
const FIELD =
  'w-full rounded-lg border border-white/10 bg-[#090907] px-3 py-2 text-[11px] text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none disabled:opacity-60';
const BTN =
  'rounded-lg border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[11px] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] active:bg-white/[0.14] disabled:opacity-40';

const W = 600;
const H = 180;

export function SignatureInput({ busy, label, confirmLabel, defaultName = '', onSign, testId = 'signature' }: {
  busy: boolean;
  /** Who is signing, for the accessible name and the sentence under the box. */
  label: string;
  confirmLabel: string;
  defaultName?: string;
  onSign: (input: { name: string; drawing?: string }) => void;
  testId?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [draw, setDraw] = useState(false);
  const [inked, setInked] = useState(false);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
  }, [draw]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    last.current = point(e);
    const ctx = e.currentTarget.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.arc(last.current.x, last.current.y, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#111111';
      ctx.fill();
    }
    setInked(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!last.current) return;
    const ctx = e.currentTarget.getContext('2d');
    const p = point(e);
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(last.current.x, last.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    last.current = p;
  };
  const up = () => {
    last.current = null;
  };
  const clear = () => {
    canvas.current?.getContext('2d')?.clearRect(0, 0, W, H);
    setInked(false);
  };

  const submit = () => {
    const typed = name.trim();
    if (typed.length < 2) return;
    // The drawing sits on white so it reads on any background when someone prints the certificate.
    let drawing: string | undefined;
    if (draw && inked && canvas.current) {
      const flat = document.createElement('canvas');
      flat.width = W;
      flat.height = H;
      const ctx = flat.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(canvas.current, 0, 0);
        drawing = flat.toDataURL('image/png');
      }
    }
    onSign({ name: typed, ...(drawing ? { drawing } : {}) });
  };

  return (
    <div className="space-y-3" data-testid={testId}>
      <label className="block space-y-1.5">
        <span className={LABEL}>Type your full name</span>
        <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" aria-label={`Full name of ${label}`} data-testid={`${testId}-name`} />
      </label>
      <div className="space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-white/60">
          <input type="checkbox" checked={draw} onChange={(e) => { setDraw(e.target.checked); setInked(false); }} data-testid={`${testId}-draw-toggle`} />
          Also draw my signature
        </label>
        {draw && (
          <div className="space-y-1.5">
            <canvas
              ref={canvas}
              width={W}
              height={H}
              className={cn('block w-full max-w-[600px] rounded-lg border border-white/20 bg-white', 'touch-none')}
              style={{ touchAction: 'none' }}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
              role="img"
              aria-label="Signature drawing area"
              data-testid={`${testId}-canvas`}
            />
            <button type="button" className={BTN} onClick={clear} data-testid={`${testId}-clear`}>Clear the drawing</button>
          </div>
        )}
      </div>
      <p className="text-[10px] leading-relaxed text-white/40">
        By signing you agree to this contract as written above. This is an in-app signature recorded with the time and a fingerprint of this exact text.
      </p>
      <button type="button" className={BTN} disabled={busy || name.trim().length < 2} onClick={submit} data-testid={`${testId}-submit`}>
        {busy ? 'Signing…' : confirmLabel}
      </button>
    </div>
  );
}
