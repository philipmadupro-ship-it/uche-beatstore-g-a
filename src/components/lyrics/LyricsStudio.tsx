'use client';

/**
 * Lyrics Studio.
 *
 *   ┌─────────────────────────┬───────────────────────┐
 *   │  Editor (textarea)      │  Word tools           │
 *   │  · auto-save 1.2s debounce                     │
 *   │  · live syllable count per line                │
 *   │  · click any word → lookup                     │
 *   │                         │  · Rhymes / Near       │
 *   │                         │  · Synonyms            │
 *   │                         │  · Antonyms            │
 *   │                         │  · Related (triggers)  │
 *   │                         │  · Definition          │
 *   ├─────────────────────────┴───────────────────────┤
 *   │  Version history (revert / preview)             │
 *   └─────────────────────────────────────────────────┘
 *
 * Word tool results are clickable — clicking inserts the word at the caret.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, History, Loader2, RefreshCw, Save, Volume2, X, Music2, Hash, Sparkles, Search,
} from 'lucide-react';

interface Props {
  trackId: string;
}

interface DatamuseHit {
  word: string;
  score?: number;
  numSyllables?: number;
}

interface DefMeaning {
  partOfSpeech: string;
  definitions: { definition: string; example: string | null }[];
  synonyms: string[];
  antonyms: string[];
}

interface DefEntry {
  word: string;
  phonetic: string | null;
  audio: string | null;
  meanings: DefMeaning[];
}

type LookupKind = 'rhymes' | 'near-rhymes' | 'synonyms' | 'antonyms' | 'related';

interface HistoryEntry { at: string; content: string }

const SAVE_DEBOUNCE_MS = 1200;

/** Cheap English syllable estimator. Good enough for an inline counter. */
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]|ed|[^laeiouy]e)$/, '')
    .replace(/^y/, '');
  const matches = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, matches?.length ?? 1);
}

function lineSyllables(line: string): number {
  return line
    .split(/\s+/)
    .filter(Boolean)
    .reduce((sum, w) => sum + countSyllables(w), 0);
}

/** Section headers — bracketed ([Hook]) or "Verse 1:" style — get marked in
 *  the gutter and excluded from the syllable count so structure reads quietly. */
const SECTION_RE = /^\s*(?:\[[^\]]+\]|(?:intro|verse|pre-?chorus|chorus|hook|bridge|refrain|outro|drop|interlude|break)\b[^a-z]*\d*\s*:?)\s*$/i;
function isSectionLine(line: string): boolean {
  return SECTION_RE.test(line.trim()) && line.trim().length > 0;
}
function sectionLabel(line: string): string {
  return line.trim().replace(/^\[|\]$/g, '').replace(/:$/, '').toUpperCase().slice(0, 10);
}

const QUICK_SECTIONS = ['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Hook', 'Bridge', 'Outro'];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export function LyricsStudio({ trackId }: Props) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<HistoryEntry | null>(null);

  // Word tools state
  const [lookupWord, setLookupWord] = useState<string>('');
  const [lookupKind, setLookupKind] = useState<LookupKind>('rhymes');
  const [hits, setHits] = useState<DatamuseHit[]>([]);
  const [hitsLoading, setHitsLoading] = useState(false);
  const [defEntries, setDefEntries] = useState<DefEntry[] | null>(null);
  const [defLoading, setDefLoading] = useState(false);
  const [sylFilter, setSylFilter] = useState<number | null>(null);
  const [resultLimit, setResultLimit] = useState<number>(40);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialLoadedRef = useRef(false);

  /* ─────── load existing lyrics + history ─────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(`/api/tracks/${trackId}/lyrics`, { cache: 'no-store' });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        setContent(j.lyrics || '');
        setSavedContent(j.lyrics || '');
        setHistory(j.history || []);
        initialLoadedRef.current = true;
      } catch (err) {
        console.warn('Lyrics fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [trackId]);

  /* ─────── debounced auto-save ─────── */
  const persist = useCallback(async (next: string, snapshot = false) => {
    setStatus('saving');
    setError(null);
    try {
      const r = await fetch(`/api/tracks/${trackId}/lyrics`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: next, snapshot }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'save failed');
      setSavedContent(next);
      setHistory(j.history || []);
      setStatus('saved');
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1400);
    } catch (err: unknown) {
      setStatus('error');
      setError(errorMessage(err, 'Save failed'));
    }
  }, [trackId]);

  useEffect(() => {
    if (!initialLoadedRef.current) return;
    if (content === savedContent) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => persist(content, false), SAVE_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [content, savedContent, persist]);

  // Save on blur immediately to avoid losing work on tab close
  const handleBlur = () => {
    if (content !== savedContent) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      persist(content, false);
    }
  };

  /* ─────── word lookups ─────── */
  const runLookup = useCallback(async (word: string, kind: LookupKind) => {
    if (!word) {
      setHits([]);
      return;
    }
    setHitsLoading(true);
    try {
      const r = await fetch(`/api/words?kind=${kind}&word=${encodeURIComponent(word)}`);
      const j = await r.json();
      setHits(Array.isArray(j.results) ? j.results : []);
    } catch {
      setHits([]);
    } finally {
      setHitsLoading(false);
    }
  }, []);

  const runDefine = useCallback(async (word: string) => {
    if (!word) {
      setDefEntries(null);
      return;
    }
    setDefLoading(true);
    try {
      const r = await fetch(`/api/words?kind=define&word=${encodeURIComponent(word)}`);
      const j = await r.json();
      setDefEntries(Array.isArray(j.entries) ? j.entries : []);
    } catch {
      setDefEntries([]);
    } finally {
      setDefLoading(false);
    }
  }, []);

  // Re-run when word or kind changes
  useEffect(() => {
    if (!lookupWord) return;
    runLookup(lookupWord, lookupKind);
    runDefine(lookupWord);
    // Reset filter + pagination when the query changes
    setSylFilter(null);
    setResultLimit(40);
  }, [lookupWord, lookupKind, runLookup, runDefine]);

  /* ─────── derived: filtered + sorted hits, syllable histogram ─────── */
  const sortedHits = useMemo(
    () => [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    [hits],
  );

  const sylBuckets = useMemo(() => {
    const m = new Map<number, number>();
    for (const h of sortedHits) {
      const s = h.numSyllables ?? countSyllables(h.word);
      m.set(s, (m.get(s) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => a[0] - b[0]);
  }, [sortedHits]);

  const visibleHits = useMemo(() => {
    const filtered = sylFilter == null
      ? sortedHits
      : sortedHits.filter((h) => (h.numSyllables ?? countSyllables(h.word)) === sylFilter);
    return filtered;
  }, [sortedHits, sylFilter]);

  const wordAtCaret = (): string => {
    const ta = textareaRef.current;
    if (!ta) return '';
    const pos = ta.selectionStart;
    const text = ta.value;
    let start = pos;
    let end = pos;
    while (start > 0 && /[A-Za-z'-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'-]/.test(text[end])) end++;
    return text.slice(start, end);
  };

  const replaceWordAtCaret = (replacement: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const text = ta.value;
    let start = pos;
    let end = pos;
    while (start > 0 && /[A-Za-z'-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'-]/.test(text[end])) end++;

    const isInWord = end > start;
    const newText = isInWord
      ? text.slice(0, start) + replacement + text.slice(end)
      : text.slice(0, pos) + replacement + text.slice(pos);
    setContent(newText);
    requestAnimationFrame(() => {
      ta.focus();
      const newCaret = (isInWord ? start : pos) + replacement.length;
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  const insertAtCaret = (str: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const pos = ta.selectionStart;
    const text = ta.value;
    setContent(text.slice(0, pos) + str + text.slice(pos));
    requestAnimationFrame(() => {
      ta.focus();
      const newCaret = pos + str.length;
      ta.setSelectionRange(newCaret, newCaret);
    });
  };

  const onTextareaSelect = () => {
    const w = wordAtCaret();
    if (w && w.toLowerCase() !== lookupWord) setLookupWord(w.toLowerCase());
  };

  /** Drop a bracketed section header at the caret on its own line. */
  const insertSection = (name: string) => {
    const ta = textareaRef.current;
    const atLineStart = !ta || ta.selectionStart === 0 || content[ta.selectionStart - 1] === '\n';
    insertAtCaret(`${atLineStart ? '' : '\n'}[${name}]\n`);
  };

  /* ─────── stats ─────── */
  const stats = useMemo(() => {
    const lines = content.split('\n');
    // Section headers don't carry syllables; mark them so the gutter shows a
    // quiet label instead of a number, and they're excluded from the count.
    const sections = lines.map(isSectionLine);
    const lineSyl = lines.map((l, i) => (sections[i] ? 0 : lineSyllables(l)));
    const sectionLabels = lines.map((l, i) => (sections[i] ? sectionLabel(l) : ''));
    const words = (content.replace(/^\s*\[[^\]]*\]\s*$/gm, '').match(/\b[A-Za-z']+\b/g) || []);
    const totalSyl = lineSyl.reduce((s, n) => s + n, 0);
    return {
      words: words.length,
      lines: lines.length,
      syllables: totalSyl,
      lineSyl,
      sections,
      sectionLabels,
    };
  }, [content]);

  /* ─────── history actions ─────── */
  const restoreEntry = (entry: HistoryEntry) => {
    setContent(entry.content);
    setHistoryPreview(null);
    setShowHistory(false);
    // Force snapshot of current first
    persist(entry.content, true);
  };

  const saveSnapshot = () => persist(content, true);

  /* ─────── UI ─────── */
  return (
    <div className="border border-[#1A1813] rounded-2xl bg-[#11100D] overflow-hidden">
      {/* toolbar — quiet header: title, live count, autosave state, version/history */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-5 min-h-10 sm:h-11 py-2 sm:py-0 bg-transparent">
        <Music2 size={12} className="text-[#F3E6D1]" />
        <span className="text-[11px] font-mono uppercase tracking-wider text-[#D0C3AF]">Lyrics</span>
        <span className="text-[10px] font-mono text-[#6E685B]">·</span>
        <span className="text-[10px] font-mono text-[#9B9282]">
          {stats.words}w · {stats.syllables} syl
        </span>
        <div className="flex-1" />
        <SaveBadge status={status} error={error} />
        <button
          onClick={saveSnapshot}
          className="text-[0px] sm:text-[10px] font-mono uppercase tracking-wider p-1.5 sm:px-2 sm:py-1 rounded-md text-[#B4AA99] hover:text-[#F7EBDD] hover:bg-white/[0.03] flex items-center gap-1 transition-colors"
          title="Save a version snapshot"
          aria-label="Save a version snapshot"
        >
          <Save size={10} /> Version
        </button>
        <button
          onClick={() => setShowHistory((v) => !v)}
          className={`text-[10px] font-mono uppercase tracking-wider p-1.5 sm:px-2 sm:py-1 rounded-md flex items-center gap-1 transition-colors ${
            showHistory
              ? 'bg-[#342F27] text-[#F3E6D1]'
              : 'text-[#B4AA99] hover:text-[#F7EBDD] hover:bg-white/[0.03]'
          }`}
          aria-label="Toggle lyrics version history"
        >
          <History size={10} /> {history.length}
        </button>
      </div>

      {/* Section quick-insert — keeps structure light + secondary. Click drops
          a header at the caret. */}
      <div className="flex items-center gap-1 px-3 sm:px-5 pb-2 sm:pb-2.5 overflow-x-auto no-scrollbar">
        <span className="hidden sm:inline text-[9px] font-mono uppercase tracking-[0.2em] text-[#6E685B] shrink-0">Section</span>
        {QUICK_SECTIONS.map((s) => (
          <button
            key={s}
            onClick={() => insertSection(s)}
            className="shrink-0 text-[8px] sm:text-[9px] font-mono uppercase tracking-wider px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-full text-[#B4AA99] hover:text-[#F3E6D1] hover:bg-[#342F27] transition-colors"
          >
            + {s}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] min-h-[340px] sm:min-h-[460px]">
        {/* editor — the calm writing surface; gutter is borderless + faint so
            the lyrics are the only thing with weight. Section lines show a
            small accent marker instead of a syllable count. */}
        <div className="relative bg-[#090907]/40">
          <div className="absolute inset-0 grid grid-cols-[32px_1fr] sm:grid-cols-[40px_1fr] overflow-hidden">
            <div className="py-3 sm:py-4 overflow-hidden pointer-events-none select-none">
              {stats.lineSyl.map((n, i) => (
                <div
                  key={i}
                  className="text-right pr-2 text-[9px] sm:text-[10px] font-mono leading-[24px] sm:leading-[28px]"
                >
                  {stats.sections[i]
                    ? <span className="text-[#C9BCA8]">§</span>
                    : <span className="text-[#332c20]">{n || ''}</span>}
                </div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onBlur={handleBlur}
              onSelect={onTextareaSelect}
              onClick={onTextareaSelect}
              onKeyUp={onTextareaSelect}
              placeholder={`Start writing…

Drop a section like [Verse] or [Hook] from the bar above.
Click any word to find rhymes, synonyms, definitions.
Everything autosaves.`}
              spellCheck
              className="w-full h-full bg-transparent text-[13px] sm:text-[15px] leading-[24px] sm:leading-[28px] text-[#F7EBDD] placeholder:text-[#6E685B] pl-1 pr-4 sm:pr-5 py-3 sm:py-4 resize-none focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* word tools — secondary sidebar, separated by a faint rule */}
        <div className="flex flex-col border-t lg:border-t-0 lg:border-l border-[#1A1813]">
          <div className="px-3 py-2 sm:py-3 border-b border-[#1A1813]">
            <div className="flex items-center gap-2 mb-2">
              <Search size={11} className="text-[#837B6D]" />
              <input
                value={lookupWord}
                onChange={(e) => setLookupWord(e.target.value.trim().toLowerCase())}
                placeholder="word"
                className="flex-1 bg-transparent text-[12px] text-[#F7EBDD] placeholder:text-[#837B6D] focus:outline-none border-b border-[#211F1A] focus:border-[#3B372F] py-1"
              />
              {lookupWord && (
                <button onClick={() => setLookupWord('')} className="text-[#9B9282] hover:text-white">
                  <X size={10} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {(['rhymes', 'near-rhymes', 'synonyms', 'antonyms', 'related'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => setLookupKind(k)}
                  className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border transition-colors ${
                    lookupKind === k
                      ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40'
                      : 'border-[#211F1A] text-[#B4AA99] hover:text-[#D0C3AF]'
                  }`}
                >
                  {k.replace('-', ' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 max-h-[260px] lg:max-h-none overflow-y-auto">
            {/* Tool results */}
            <div className="px-3 py-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] font-mono uppercase tracking-wider text-[#837B6D] flex items-center gap-1.5">
                  <Sparkles size={9} /> {lookupKind.replace('-', ' ')}
                  {sortedHits.length > 0 && (
                    <span className="text-[#B4AA99]">· {visibleHits.length}/{sortedHits.length}</span>
                  )}
                </p>
              </div>

              {/* Syllable filter chips — only show when we have multiple buckets */}
              {sylBuckets.length > 1 && (
                <div className="flex items-center gap-1 flex-wrap mb-2">
                  <button
                    onClick={() => setSylFilter(null)}
                    className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
                      sylFilter == null
                        ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40'
                        : 'border-[#211F1A] text-[#B4AA99] hover:text-[#D0C3AF]'
                    }`}
                  >
                    all
                  </button>
                  {sylBuckets.map(([n, count]) => (
                    <button
                      key={n}
                      onClick={() => setSylFilter(n)}
                      title={`${count} ${n}-syllable result${count === 1 ? '' : 's'}`}
                      className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border transition-colors ${
                        sylFilter === n
                          ? 'bg-[#342F27] text-[#F3E6D1] border-[#C9BCA8]/40'
                          : 'border-[#211F1A] text-[#B4AA99] hover:text-[#D0C3AF]'
                      }`}
                    >
                      {n} syl <span className="text-[#837B6D]">·{count}</span>
                    </button>
                  ))}
                </div>
              )}

              {hitsLoading ? (
                <Loader2 size={12} className="animate-spin text-[#837B6D]" />
              ) : !lookupWord ? (
                <p className="text-[10px] text-[#837B6D] italic">Click a word in the editor or type one above.</p>
              ) : visibleHits.length === 0 ? (
                <p className="text-[10px] text-[#9B9282]">
                  {sylFilter != null ? `No ${sylFilter}-syllable results.` : 'No results.'}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {visibleHits.slice(0, resultLimit).map((h) => {
                      const syl = h.numSyllables ?? countSyllables(h.word);
                      return (
                        <button
                          key={h.word + (h.score ?? '')}
                          onClick={() => replaceWordAtCaret(h.word)}
                          title={`${syl} syl${h.score ? ` · score ${h.score}` : ''}`}
                          className="text-[10px] px-2 py-0.5 rounded-md border border-[#211F1A] bg-[#171511] text-[#F7EBDD] hover:bg-[#342F27] hover:border-[#C9BCA8]/40 hover:text-[#F3E6D1] transition-colors"
                        >
                          {h.word}
                          <span className="ml-1 text-[#837B6D]">·{syl}</span>
                        </button>
                      );
                    })}
                  </div>
                  {visibleHits.length > resultLimit && (
                    <button
                      onClick={() => setResultLimit((n) => n + 40)}
                      className="mt-2 text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] hover:text-[#F3E6D1] border border-[#211F1A] hover:border-[#C9BCA8]/40 rounded px-2 py-1"
                    >
                      Show more · {visibleHits.length - resultLimit} hidden
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Definition */}
            <div className="px-3 py-2 border-t border-[#1A1813]">
              <p className="text-[9px] font-mono uppercase tracking-wider text-[#837B6D] mb-2 flex items-center gap-1.5">
                <BookOpen size={9} /> definition
              </p>
              {defLoading ? (
                <Loader2 size={12} className="animate-spin text-[#837B6D]" />
              ) : !lookupWord ? (
                <p className="text-[10px] text-[#837B6D] italic">—</p>
              ) : !defEntries || defEntries.length === 0 ? (
                <p className="text-[10px] text-[#9B9282]">No definition found.</p>
              ) : (
                <div className="space-y-2">
                  {defEntries.slice(0, 1).map((e, i) => (
                    <div key={i}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px] text-[#F7EBDD]">{e.word}</span>
                        {e.phonetic && (
                          <span className="text-[10px] font-mono text-[#B4AA99]">{e.phonetic}</span>
                        )}
                        {e.audio && (
                          <button
                            className="text-[#B4AA99] hover:text-[#F3E6D1]"
                            onClick={() => new Audio(e.audio!).play().catch(() => {})}
                            title="Pronounce"
                          >
                            <Volume2 size={10} />
                          </button>
                        )}
                      </div>
                      {e.meanings.slice(0, 2).map((m, j) => (
                        <div key={j} className="mb-1">
                          <p className="text-[9px] font-mono uppercase tracking-wider text-[#B4AA99] mb-0.5">
                            {m.partOfSpeech}
                          </p>
                          {m.definitions.slice(0, 2).map((d, k) => (
                            <p key={k} className="text-[10px] text-[#D0C3AF] mb-1 leading-snug">
                              {d.definition}
                              {d.example && (
                                <span className="block text-[#9B9282] italic">“{d.example}”</span>
                              )}
                            </p>
                          ))}
                          {m.synonyms.length > 0 && (
                            <p className="text-[9px] text-[#837B6D]">
                              <span className="text-[#B4AA99] mr-1">syn:</span>
                              {m.synonyms.slice(0, 6).map((s) => (
                                <button
                                  key={s}
                                  onClick={() => replaceWordAtCaret(s)}
                                  className="text-[#D0C3AF] hover:text-[#F3E6D1] mr-1"
                                >
                                  {s}
                                </button>
                              ))}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* History */}
      {showHistory && (
        <div className="border-t border-[#1A1813] bg-[#090907]">
          <div className="flex items-center justify-between px-4 h-9 border-b border-[#1A1813]">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#D0C3AF]">
              Version history · {history.length}
            </span>
            <button onClick={() => setShowHistory(false)} className="text-[#9B9282] hover:text-white">
              <X size={11} />
            </button>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {history.length === 0 ? (
              <p className="text-[10px] text-[#9B9282] px-4 py-3">No prior versions yet.</p>
            ) : (
              history.map((h, i) => {
                const isPreview = historyPreview === h;
                return (
                  <div
                    key={i}
                    className={`px-4 py-2 border-b border-[#24211B] last:border-b-0 flex items-start gap-3 ${
                      isPreview ? 'bg-[#11100D]' : ''
                    }`}
                  >
                    <Hash size={9} className="text-[#6E685B] mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-mono text-[#D0C3AF]">
                        {new Date(h.at).toLocaleString()}
                      </p>
                      <p className="text-[10px] text-[#9B9282] truncate font-mono">
                        {h.content.split('\n').slice(0, 1).join(' ')}
                        <span className="text-[#837B6D]"> · {h.content.length} chars</span>
                      </p>
                      {isPreview && (
                        <pre className="mt-2 text-[10px] text-[#D0C3AF] whitespace-pre-wrap font-mono max-h-[120px] overflow-y-auto bg-[#090907] border border-[#211F1A] rounded p-2">
                          {h.content}
                        </pre>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setHistoryPreview(isPreview ? null : h)}
                        className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border border-[#211F1A] text-[#D0C3AF] hover:text-white hover:border-[#3B372F]"
                      >
                        {isPreview ? 'Hide' : 'Preview'}
                      </button>
                      <button
                        onClick={() => restoreEntry(h)}
                        className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-1 rounded border border-[#211F1A] text-[#F3E6D1] hover:bg-[#342F27] hover:border-[#C9BCA8]/40 flex items-center gap-1"
                      >
                        <RefreshCw size={9} /> Restore
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveBadge({ status, error }: { status: string; error: string | null }) {
  if (status === 'saving') {
    return (
      <span className="text-[10px] font-mono text-[#D0C3AF] flex items-center gap-1">
        <Loader2 size={9} className="animate-spin" /> saving
      </span>
    );
  }
  if (status === 'saved') {
    return <span className="text-[10px] font-mono text-green-400">saved</span>;
  }
  if (status === 'error') {
    return (
      <span className="text-[10px] font-mono text-red-400" title={error || ''}>
        save failed
      </span>
    );
  }
  return <span className="text-[10px] font-mono text-[#6E685B]">·</span>;
}
