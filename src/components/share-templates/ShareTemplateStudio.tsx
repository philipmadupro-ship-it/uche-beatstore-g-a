'use client';

/**
 * Share templates: pick a template and an output size, see the real image for
 * a real listed beat, download it as a PNG.
 *
 * Drawing is the Cover Art Studio's renderer (`lib/share/templates`), not a
 * second one. The template choice saves as `share_card_style`, as before.
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Dropdown } from '@/components/ui/Dropdown';
import { toast } from '@/hooks/useToast';
import { CARD_STYLE_META, asCardStyle, type CardStyle } from '@/lib/share/styles';
import {
  SHARE_PRESET_IDS, SHARE_PRESETS, presetFilename, type SharePresetId,
} from '@/lib/share/presets';
import { buildShareFill, type ShareFill } from '@/lib/share/templates/fill';
import { shareSvgForPreview } from '@/lib/share/templates/preview';
import { exportShareImage } from '@/lib/share/templates/export';

export type ShareStudioTrack = {
  id: string;
  title: string;
  cover_url: string | null;
  bpm: number | null;
  key: string | null;
  scale: string | null;
  store_listed: boolean;
};

type Props = {
  value: string;
  onChange: (style: string) => void;
  tracks: ShareStudioTrack[];
  artist: string;
  accent: string;
};

function Frame({ svg, ratio, label }: { svg: string; ratio: number; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="w-full overflow-hidden rounded-lg bg-[#090907]"
      style={{ aspectRatio: String(ratio) }}
      // The markup is our own renderer's output; every user string is escaped there.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function ShareTemplateStudio({ value, onChange, tracks, artist, accent }: Props) {
  const listed = useMemo(() => tracks.filter((t) => t.store_listed), [tracks]);
  const [trackId, setTrackId] = useState('');
  const [presetId, setPresetId] = useState<SharePresetId>('story');
  const [peaks, setPeaks] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const style: CardStyle = asCardStyle(value);
  const track = listed.find((t) => t.id === trackId) ?? listed[0] ?? null;
  const preset = SHARE_PRESETS[presetId];

  // Peaks come from the PUBLIC sidecar route, which serves listed beats only.
  useEffect(() => {
    setPeaks([]);
    if (!track) return undefined;
    const ctl = new AbortController();
    fetch(`/api/store/peaks/${encodeURIComponent(track.id)}`, { signal: ctl.signal, credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && Array.isArray(j.peaks)) setPeaks(j.peaks); })
      .catch(() => {});
    return () => ctl.abort();
  }, [track]);

  const fill: ShareFill = useMemo(() => buildShareFill({
    title: track?.title ?? 'Your next beat',
    artist,
    coverUrl: track?.cover_url ?? null,
    peaks,
    bpm: track?.bpm ?? null,
    key: track?.key ?? null,
    scale: track?.scale ?? null,
    accent,
    eyebrow: 'Now playing',
  }), [track, artist, accent, peaks]);

  const previews = useMemo(() => ({
    main: shareSvgForPreview(style, fill, preset),
    thumbs: CARD_STYLE_META.map((m) => ({ id: m.id, svg: shareSvgForPreview(m.id, fill, preset) })),
  }), [style, fill, preset]);

  const download = async () => {
    setBusy(true);
    try {
      const { blob, lostCover } = await exportShareImage(style, fill, preset);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = presetFilename(fill.title, preset);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (lostCover) toast.info('Exported without the cover', 'The cover could not be read from its host.');
    } catch {
      toast.error('Could not export the image');
    } finally {
      setBusy(false);
    }
  };

  const ratio = preset.width / preset.height;

  return (
    <div className="mb-6 space-y-4" data-testid="share-template-studio">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-lg border border-white/10 p-1" role="tablist" aria-label="Output size">
          {SHARE_PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={presetId === id}
              data-testid={`share-preset-${id}`}
              onClick={() => setPresetId(id)}
              className={`rounded-md px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition-colors ${
                presetId === id ? 'bg-white/[0.14] text-white' : 'text-white/40 hover:bg-white/[0.06] hover:text-white/80'
              }`}
            >
              {SHARE_PRESETS[id].label}
            </button>
          ))}
        </div>
        {listed.length > 0 && (
          <Dropdown
            aria-label="Preview beat"
            label="Beat:"
            value={track?.id ?? ''}
            onChange={setTrackId}
            options={listed.map((t) => ({ value: t.id, label: t.title }))}
          />
        )}
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-white/40">{preset.hint}</span>
      </div>

      {listed.length === 0 && (
        <p className="text-xs text-white/40">List a beat in the store to preview templates with real data. Showing a sample.</p>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr]">
        <div className="space-y-3">
          <div data-testid="share-preview" data-preset={presetId} data-style={style}>
            <Frame svg={previews.main} ratio={ratio} label={`${style} template, ${preset.label}`} />
          </div>
          <button
            type="button"
            onClick={download}
            disabled={busy}
            data-testid="share-download"
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/80 transition-colors hover:border-white/20 hover:bg-white/[0.10] disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download PNG · {preset.width}×{preset.height}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Template">
          {CARD_STYLE_META.map((meta) => {
            const active = style === meta.id;
            const thumb = previews.thumbs.find((t) => t.id === meta.id);
            return (
              <button
                key={meta.id}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`share-template-${meta.id}`}
                onClick={() => onChange(meta.id)}
                title={meta.description}
                className={`overflow-hidden rounded-xl border text-left transition-colors ${
                  active ? 'border-white/30' : 'border-white/10 hover:border-white/20'
                }`}
              >
                <Frame svg={thumb?.svg ?? ''} ratio={ratio} label={`${meta.label} preview`} />
                <div className="bg-white/[0.04] px-2 py-1.5">
                  <p className="text-[11px] font-medium text-white">{meta.label}</p>
                  <p className="line-clamp-2 text-[10px] text-white/40">{meta.description}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
