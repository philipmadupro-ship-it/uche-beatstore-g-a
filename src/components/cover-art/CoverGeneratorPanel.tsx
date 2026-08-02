'use client';

/**
 * AI cover generation panel — the "Media" tool in the studio.
 *
 * Self-contained on purpose. `ContextPanel` already takes ~25 props; threading
 * a dozen more through it for one tool would make the studio harder to change,
 * not easier. This owns its own request state and reports a finished image back
 * through a single callback.
 *
 * The generated image is converted to a data URI before it becomes a layer.
 * The bytes live on R2 (a different origin), and an SVG rendered through
 * `<img>`/canvas for export cannot fetch cross-origin resources — the exported
 * PNG would silently lose the artwork while the on-screen preview looked
 * correct. Inlining sidesteps that. The R2 URL is kept alongside it for
 * attaching as the actual cover, where a plain URL is what's wanted.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, AlertTriangle, Image as ImageIcon } from 'lucide-react';
import type { ArtworkPalette } from './cover-art-document';

type Provider = 'openai' | 'gemini';

interface Props {
  palette: ArtworkPalette;
  /** Art-direction name, folded into the prompt as style guidance. */
  styleName: string;
  /** Track/project tags, used as mood guidance. */
  tags?: string[];
  /** Receives the inlined data URI plus the stored R2 URL. */
  onGenerated: (image: { dataUrl: string; url: string }) => void;
}

/** Palette entries offered as colour influence, in a sensible order. */
const PALETTE_KEYS: Array<{ key: keyof ArtworkPalette; label: string }> = [
  { key: 'background', label: 'Background' },
  { key: 'accent', label: 'Accent' },
  { key: 'secondary', label: 'Secondary' },
  { key: 'panel', label: 'Panel' },
  { key: 'text', label: 'Text' },
];

const PRESETS = [
  { label: 'Grainy film photo', prompt: 'a grainy 35mm film photograph, shallow depth of field, dust and light leaks' },
  { label: 'Brutalist concrete', prompt: 'raw brutalist concrete architecture, hard directional light, deep shadow' },
  { label: 'Liquid chrome', prompt: 'flowing liquid chrome forms, high specular reflection, studio lighting' },
  { label: 'Night city haze', prompt: 'a hazy neon-lit city street at night, wet asphalt, long lens compression' },
  { label: 'Mineral macro', prompt: 'extreme macro of a cracked mineral surface, iridescent flecks' },
  { label: 'Smoke on black', prompt: 'a single plume of smoke on a black field, rim lit, high contrast' },
];

export function CoverGeneratorPanel({ palette, styleName, tags, onGenerated }: Props) {
  const [providers, setProviders] = useState<{ openai: boolean; gemini: boolean } | null>(null);
  const [provider, setProvider] = useState<Provider | undefined>(undefined);
  const [prompt, setPrompt] = useState('');
  const [avoid, setAvoid] = useState('');
  const [useColors, setUseColors] = useState<Set<keyof ArtworkPalette>>(
    () => new Set<keyof ArtworkPalette>(['background', 'accent']),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Which providers the server can actually use. Booleans only — the route
  // never returns keys or any prefix of them.
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cover/generate')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled || !j?.providers) return;
        setProviders(j.providers);
        setProvider(j.providers.openai ? 'openai' : j.providers.gemini ? 'gemini' : undefined);
      })
      .catch(() => { if (!cancelled) setProviders({ openai: false, gemini: false }); });
    return () => { cancelled = true; };
  }, []);

  const toggleColor = useCallback((key: keyof ArtworkPalette) => {
    setUseColors((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cover/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          provider,
          style: styleName,
          palette: [...useColors].map((k) => palette[k]),
          tags,
          avoid: avoid.trim() || undefined,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.url) {
        setError(json?.error || `Generation failed (${res.status}).`);
        return;
      }
      setLastPrompt(json.prompt ?? null);

      // Inline through the same-origin optimizer so export keeps the artwork.
      const dataUrl = await toDataUrl(json.url);
      setPreview(dataUrl ?? json.url);
      onGenerated({ dataUrl: dataUrl ?? json.url, url: json.url });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.');
    } finally {
      setBusy(false);
    }
  }, [prompt, provider, styleName, useColors, palette, tags, avoid, onGenerated]);

  const noProviders = providers && !providers.openai && !providers.gemini;

  return (
    <div className="space-y-4">
      {noProviders ? (
        <div className="flex gap-2 border border-[#A9523566] bg-[#A952351A] p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#A95235]" />
          <div className="space-y-1">
            <p className="text-[12px] text-[#EEE8DD]">No image provider configured.</p>
            <p className="text-[11px] leading-relaxed text-[#706B61]">
              Set <code className="text-[#D4BFA0]">OPENAI_API_KEY</code> or{' '}
              <code className="text-[#D4BFA0]">GEMINI_API_KEY</code> in the server environment
              (Vercel → Settings → Environment Variables), then redeploy. Keys stay server-side and
              are never sent to the browser.
            </p>
          </div>
        </div>
      ) : null}

      {providers && (providers.openai || providers.gemini) ? (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#706B61]">Provider</p>
          <div className="flex gap-2">
            {(['openai', 'gemini'] as Provider[]).filter((p) => providers[p]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setProvider(p)}
                className={`border px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] transition ${
                  provider === p
                    ? 'border-[#D4BFA0] bg-[#D4BFA01A] text-[#EEE8DD]'
                    : 'border-[#EBE1CC1A] text-[#706B61] hover:border-[#EBE1CC33]'
                }`}
              >
                {p === 'openai' ? 'OpenAI' : 'Gemini'}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-2">
        <label htmlFor="cover-prompt" className="block text-[10px] uppercase tracking-[0.2em] text-[#706B61]">
          Prompt
        </label>
        <textarea
          id="cover-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Describe the artwork — subject, texture, light…"
          className="w-full resize-y border border-[#EBE1CC1A] bg-[#0D0D0A] p-2.5 text-[12px] text-[#EEE8DD] placeholder:text-[#4A463E] focus-visible:border-[#D4BFA0] focus-visible:outline-none"
        />
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPrompt(p.prompt)}
              className="border border-[#EBE1CC1A] px-2 py-1 text-[10px] text-[#706B61] transition hover:border-[#EBE1CC33] hover:text-[#EEE8DD]"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.2em] text-[#706B61]">Colour influence</p>
        <div className="flex flex-wrap gap-1.5">
          {PALETTE_KEYS.map(({ key, label }) => {
            const on = useColors.has(key);
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleColor(key)}
                aria-pressed={on}
                className={`flex items-center gap-1.5 border px-2 py-1 text-[10px] transition ${
                  on ? 'border-[#D4BFA0] text-[#EEE8DD]' : 'border-[#EBE1CC1A] text-[#706B61]'
                }`}
              >
                <span
                  aria-hidden
                  className="h-3 w-3 border border-[#EBE1CC33]"
                  style={{ background: palette[key] }}
                />
                {label}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-[#4A463E]">
          Selected colours are sent as exact hex values so the artwork matches your palette.
        </p>
      </div>

      <div className="space-y-2">
        <label htmlFor="cover-avoid" className="block text-[10px] uppercase tracking-[0.2em] text-[#706B61]">
          Avoid (optional)
        </label>
        <input
          id="cover-avoid"
          value={avoid}
          onChange={(e) => setAvoid(e.target.value)}
          placeholder="faces, people, clutter…"
          className="w-full border border-[#EBE1CC1A] bg-[#0D0D0A] p-2 text-[12px] text-[#EEE8DD] placeholder:text-[#4A463E] focus-visible:border-[#D4BFA0] focus-visible:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={generate}
        disabled={busy || !prompt.trim() || !provider}
        className="flex w-full items-center justify-center gap-2 border border-[#D4BFA0] bg-[#D4BFA0] px-3 py-2.5 text-[11px] uppercase tracking-[0.16em] text-[#0D0D0A] transition disabled:cursor-not-allowed disabled:border-[#EBE1CC1A] disabled:bg-transparent disabled:text-[#4A463E]"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {busy ? 'Generating…' : 'Generate cover'}
      </button>

      {error ? (
        <div className="flex gap-2 border border-[#A9523566] bg-[#A952351A] p-2.5">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#A95235]" />
          <p className="text-[11px] leading-relaxed text-[#EEE8DD]">{error}</p>
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[#706B61]">Result</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Generated cover artwork"
            className="w-full border border-[#EBE1CC1A]"
          />
          <p className="text-[10px] text-[#4A463E]">
            Added as an image layer. Use the canvas to position it.
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-2 border border-dashed border-[#EBE1CC1A] p-4 text-[11px] text-[#4A463E]">
          <ImageIcon className="h-4 w-4" />
          No generated artwork yet.
        </div>
      )}

      {lastPrompt ? (
        <details className="border border-[#EBE1CC1A] p-2">
          <summary className="cursor-pointer text-[10px] uppercase tracking-[0.2em] text-[#706B61]">
            Prompt actually sent
          </summary>
          <p className="mt-2 text-[11px] leading-relaxed text-[#706B61]">{lastPrompt}</p>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Fetch an image through Next's same-origin optimizer and inline it.
 *
 * Returns null on failure so the caller can fall back to the raw URL — a
 * preview that works but exports without artwork beats no preview at all.
 */
async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(`/_next/image?url=${encodeURIComponent(url)}&w=1080&q=90`);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
