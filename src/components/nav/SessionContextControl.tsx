'use client';

import { useCallback, useRef, useState } from 'react';
import { Music2 } from 'lucide-react';

import { Popover } from '@/components/ui/Popover';
import { useSessionContext, TOLERANCE_CHOICES } from '@/hooks/useSessionContext';
import { type CanonicalKey, type Scale } from '@/lib/audio/key-normalize';
import { MIN_SESSION_BPM, MAX_SESSION_BPM, describeSession } from '@/lib/audio/session-match';
import { pushTap, tempoFromTaps } from '@/lib/audio/tap-tempo';

/**
 * The always-visible session control: what tempo and key the producer is
 * working in, so every track row can say whether it fits.
 *
 * Lives in the TopBar's right cluster because that is the only chrome visible
 * on every dashboard route, and because a second TopBar row is not available —
 * the hub dropdowns replaced one, deliberately. That budget is about 32px
 * tall, so the control is a pill that states the session and opens a popover
 * to change it.
 */

/** Musical key gets the warm accent; everything else stays white at alpha. */
const KEY_ACCENT = '#c8a47a';

const CONTROL_REST = 'bg-white/[0.06] border border-white/10 hover:bg-white/[0.10] hover:border-white/20';

/** Sharps sit between the naturals below them, as on a keyboard. */
const NATURALS: CanonicalKey[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SHARPS: Array<CanonicalKey | null> = ['C#', 'D#', null, 'F#', 'G#', 'A#', null];

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40 mb-2">
      {children}
    </div>
  );
}

/**
 * The tempo field keeps its own text so it can be emptied while typing, and
 * only commits once the value is a plausible tempo. Committing on every
 * keystroke means typing "140" sets the session to 1, then 14, and the rows
 * re-mark twice on the way to the answer.
 */
function TempoField({
  bpm,
  onCommit,
}: {
  bpm: number | null;
  onCommit: (bpm: number | null) => void;
}) {
  // A draft exists only while the field is being edited. The rest of the time
  // the store IS the value, so a tap, ½ / 2× or Clear shows up here with no
  // syncing — which is what keeps this out of an effect. Mirroring the store
  // into state and correcting it afterwards is the cascading-render pattern
  // React's lint rule exists to catch.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? (bpm == null ? '' : String(bpm));

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === '') return onCommit(null);
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    onCommit(n);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      value={text}
      aria-label="Session tempo in BPM"
      placeholder="—"
      min={MIN_SESSION_BPM}
      max={MAX_SESSION_BPM}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = Number(e.target.value);
        // Below the minimum is most likely a tempo still being typed (the "1"
        // of "140"), so it waits for the rest, or for blur.
        if (Number.isFinite(n) && n >= MIN_SESSION_BPM && n <= MAX_SESSION_BPM) onCommit(n);
      }}
      onBlur={(e) => { commit(e.target.value); setDraft(null); }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      className={`w-20 rounded-lg px-2 py-1.5 text-sm text-white/80 tabular-nums ${CONTROL_REST} focus:outline-none focus:border-white/30`}
    />
  );
}

export function SessionContextControl() {
  const bpm = useSessionContext((s) => s.bpm);
  const musicKey = useSessionContext((s) => s.key);
  const scale = useSessionContext((s) => s.scale);
  const matchTolerance = useSessionContext((s) => s.matchTolerance);
  const previewInSession = useSessionContext((s) => s.previewInSession);
  const setBpm = useSessionContext((s) => s.setBpm);
  const setKey = useSessionContext((s) => s.setKey);
  const setScale = useSessionContext((s) => s.setScale);
  const makeRelative = useSessionContext((s) => s.makeRelative);
  const scaleTempo = useSessionContext((s) => s.scaleTempo);
  const setMatchTolerance = useSessionContext((s) => s.setMatchTolerance);
  const setPreviewInSession = useSessionContext((s) => s.setPreviewInSession);
  const clear = useSessionContext((s) => s.clear);

  // Taps live in a ref: extending the window should not re-render the panel.
  const taps = useRef<number[]>([]);
  const [tapCount, setTapCount] = useState(0);

  const tap = useCallback(() => {
    taps.current = pushTap(taps.current, performance.now());
    setTapCount(taps.current.length);
    const next = tempoFromTaps(taps.current);
    if (next != null) setBpm(next);
  }, [setBpm]);

  const summary = describeSession({ bpm, key: musicKey, scale });
  const active = summary !== '';

  /** Clicking the selected value clears it, so each half stays optional. */
  const toggleKey = (k: CanonicalKey) => setKey(musicKey === k ? null : k);
  const toggleScale = (s: Scale) => setScale(scale === s ? null : s);

  return (
    <Popover
      width={288}
      align="right"
      label="Session tempo and key"
      trigger={({ open, toggle, ref }) => (
        <button
          ref={ref as (el: HTMLButtonElement | null) => void}
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="dialog"
          // The visible text is the session itself ("140 BPM · F minor"),
          // which as an accessible name says what the value is but never what
          // the control is. Named explicitly so it does both.
          aria-label={active ? `Session: ${summary}. Change tempo and key` : 'Set your session tempo and key'}
          title={active ? `Session: ${summary}` : 'Set your session tempo and key'}
          className={`tap flex items-center gap-2 bg-white/[0.04] border rounded-md py-1.5 px-2 md:px-3 text-[11px] transition-colors shrink-0 ${
            active ? 'border-white/20 text-white/80' : 'border-white/10 text-white/60 hover:border-white/20 hover:text-white'
          }`}
        >
          <Music2 size={14} style={active ? { color: KEY_ACCENT } : undefined} />
          {/* On a phone the right cluster has no room for a word that says
              nothing yet, so an unset session is the icon alone. Once it is
              set the value itself is worth the space — bounded, because
              "140 BPM · F minor" would otherwise push the cluster off-screen.
              The button is named by `aria-label` either way. */}
          <span
            className={`tabular-nums truncate max-w-[7rem] md:max-w-none ${
              active ? '' : 'hidden md:inline'
            }`}
          >
            {active ? summary : 'Session'}
          </span>
        </button>
      )}
    >
      {() => (
        <div className="p-3 w-full">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-white/40">
              Session
            </div>
            {active && (
              <button
                onClick={clear}
                className="text-[10px] text-white/40 hover:text-white/80 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <Label>Tempo</Label>
          <div className="flex items-center gap-2 mb-4">
            <TempoField bpm={bpm} onCommit={setBpm} />
            <button
              onClick={tap}
              aria-label="Tap tempo"
              className={`rounded-lg px-3 py-1.5 text-xs text-white/60 hover:text-white transition-colors ${CONTROL_REST}`}
            >
              Tap{tapCount > 1 ? ` ×${tapCount}` : ''}
            </button>
            <button
              onClick={() => scaleTempo(0.5)}
              disabled={bpm == null}
              aria-label="Halve the session tempo"
              className={`rounded-lg px-2 py-1.5 text-xs text-white/60 hover:text-white transition-colors disabled:opacity-40 ${CONTROL_REST}`}
            >
              ½
            </button>
            <button
              onClick={() => scaleTempo(2)}
              disabled={bpm == null}
              aria-label="Double the session tempo"
              className={`rounded-lg px-2 py-1.5 text-xs text-white/60 hover:text-white transition-colors disabled:opacity-40 ${CONTROL_REST}`}
            >
              2×
            </button>
          </div>

          <Label>Key</Label>
          <div className="mb-2">
            <div className="flex gap-1 mb-1 pl-5">
              {SHARPS.map((k, i) =>
                k == null ? (
                  <div key={`gap-${i}`} className="w-8 shrink-0" aria-hidden />
                ) : (
                  <KeyButton key={k} k={k} selected={musicKey === k} onClick={() => toggleKey(k)} />
                ),
              )}
            </div>
            <div className="flex gap-1">
              {NATURALS.map((k) => (
                <KeyButton key={k} k={k} selected={musicKey === k} onClick={() => toggleKey(k)} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 mb-4">
            {(['major', 'minor'] as Scale[]).map((s) => (
              <button
                key={s}
                onClick={() => toggleScale(s)}
                aria-pressed={scale === s}
                className={`rounded-lg px-3 py-1.5 text-xs capitalize transition-colors ${
                  scale === s
                    ? 'bg-white/[0.14] border border-white/30 text-white/80'
                    : `text-white/60 hover:text-white ${CONTROL_REST}`
                }`}
              >
                {s}
              </button>
            ))}
            {musicKey != null && scale != null && (
              <button
                onClick={makeRelative}
                title="Swap to the relative major or minor — the key sharing the same notes"
                className="ml-auto text-[11px] text-white/40 hover:text-white/80 transition-colors"
              >
                Make relative
              </button>
            )}
          </div>

          <Label>Tempo match</Label>
          <div className="flex items-center gap-1 mb-4" role="group" aria-label="How close a tempo must be to count as a match">
            {TOLERANCE_CHOICES.map((t) => (
              <button
                key={t}
                onClick={() => setMatchTolerance(t)}
                aria-pressed={matchTolerance === t}
                className={`rounded-lg px-3 py-1.5 text-xs tabular-nums transition-colors ${
                  matchTolerance === t
                    ? 'bg-white/[0.14] border border-white/30 text-white/80'
                    : `text-white/60 hover:text-white ${CONTROL_REST}`
                }`}
              >
                {t === 0 ? 'Exact' : `±${t}`}
              </button>
            ))}
          </div>

          <button
            onClick={() => setPreviewInSession(!previewInSession)}
            aria-pressed={previewInSession}
            disabled={bpm == null}
            className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors disabled:opacity-40 ${
              previewInSession
                ? 'bg-white/[0.14] border border-white/30 text-white/80'
                : `text-white/60 hover:text-white ${CONTROL_REST}`
            }`}
          >
            <span className="block">Preview at session tempo</span>
            <span className="block text-[10px] text-white/40 mt-0.5">
              {bpm == null
                ? 'Set a tempo first'
                : 'Time-stretched, pitch kept. Downloads are unchanged.'}
            </span>
          </button>
        </div>
      )}
    </Popover>
  );
}

function KeyButton({
  k,
  selected,
  onClick,
}: {
  k: CanonicalKey;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`Key of ${k}`}
      style={selected ? { borderColor: KEY_ACCENT, color: KEY_ACCENT } : undefined}
      className={`w-8 shrink-0 rounded-lg py-1.5 text-[11px] tabular-nums transition-colors ${
        selected
          ? 'bg-white/[0.14] border'
          : `text-white/60 hover:text-white ${CONTROL_REST}`
      }`}
    >
      {k}
    </button>
  );
}
