'use client';

import { Download, Loader2, Save } from 'lucide-react';

interface Props {
  take: { url: string; size: number; mime: string };
  saving: boolean;
  onSave: () => void;
}

/**
 * Last-recorded take preview — audio playback, byte-size + MIME readout,
 * download link, and "Save to library" action.
 *
 * Extracted from StudioWorkstation. The download link is intentionally
 * a plain <a download> rather than the /api/audio proxy because the
 * URL is an in-memory blob — already same-origin, browsers honor the
 * download attribute on blob URLs unconditionally.
 */
export function StudioLastTake({ take, saving, onSave }: Props) {
  const extension = take.mime.includes('webm') ? 'webm' : 'audio';
  const downloadName = `studio-take-${take.size}.${extension}`;

  return (
    <div className="border border-[#0E0E0E] rounded-lg p-5 bg-[#090907]">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white">Last take</p>
          <p className="text-[10px] text-white/40 mt-1 font-mono">
            {(take.size / (1024 * 1024)).toFixed(2)} MB · {take.mime}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={take.url}
            download={downloadName}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-white/10 bg-white/[0.04] text-white/80 hover:text-white text-[11px] font-medium transition-colors"
          >
            <Download size={11} /> Download
          </a>
          <button
            onClick={onSave}
            disabled={saving}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-white text-black hover:bg-white text-[11px] font-medium transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
            Save to library
          </button>
        </div>
      </div>
      <audio src={take.url} controls className="w-full h-8" />
    </div>
  );
}
