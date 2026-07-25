import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * Word tools. Single endpoint with `?kind=` so the client doesn't fan out
 * across many routes.
 *
 *   GET /api/words?kind=rhymes&word=fire             — Datamuse rhymes
 *   GET /api/words?kind=near-rhymes&word=fire        — Datamuse near-rhymes
 *   GET /api/words?kind=synonyms&word=fire           — Datamuse means-like
 *   GET /api/words?kind=antonyms&word=fire           — Datamuse antonyms
 *   GET /api/words?kind=related&word=fire            — Datamuse triggers
 *   GET /api/words?kind=define&word=fire             — Free Dictionary API
 *   GET /api/words?kind=syllables&word=fire          — Datamuse with syllables metadata
 */

interface DatamuseHit { word: string; score?: number; numSyllables?: number; tags?: string[] }

interface DictionaryPhonetic {
  audio?: string;
}

interface DictionaryDefinition {
  definition?: string;
  example?: string;
}

interface DictionaryMeaning {
  partOfSpeech?: string;
  definitions?: DictionaryDefinition[];
  synonyms?: string[];
  antonyms?: string[];
}

interface DictionaryEntry {
  word?: string;
  phonetic?: string;
  phonetics?: DictionaryPhonetic[];
  meanings?: DictionaryMeaning[];
}

const DATAMUSE = 'https://api.datamuse.com/words';

async function dm(params: Record<string, string>) {
  // 100 gives us enough headroom for the client to filter by syllables and
  // still have a useful pool. Datamuse caps at 1000 but 100 is plenty.
  const qs = new URLSearchParams({ ...params, max: '100' });
  const res = await fetch(`${DATAMUSE}?${qs}`, { next: { revalidate: 60 * 60 } });
  if (!res.ok) throw new Error(`datamuse ${res.status}`);
  return (await res.json()) as DatamuseHit[];
}

async function define(word: string) {
  const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
  const res = await fetch(url, { next: { revalidate: 60 * 60 * 24 } });
  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`dict ${res.status}`);
  }
  const arr = await res.json();
  if (!Array.isArray(arr)) return [];
  return (arr as DictionaryEntry[]).map((e) => ({
    word: e.word,
    phonetic: e.phonetic ?? null,
    audio: (e.phonetics || []).find((p) => p.audio)?.audio || null,
    meanings: (e.meanings || []).map((m) => ({
      partOfSpeech: m.partOfSpeech,
      definitions: (m.definitions || [])
        .slice(0, 4)
        .map((d) => ({ definition: d.definition, example: d.example ?? null })),
      synonyms: m.synonyms || [],
      antonyms: m.antonyms || [],
    })),
  }));
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const kind = (searchParams.get('kind') || '').toLowerCase();
  const word = (searchParams.get('word') || '').trim();
  if (!word) return NextResponse.json({ error: 'word required' }, { status: 400 });
  if (word.length > 40) return NextResponse.json({ error: 'word too long' }, { status: 400 });

  try {
    switch (kind) {
      case 'rhymes':
        return NextResponse.json({ word, results: await dm({ rel_rhy: word, md: 's' }) });
      case 'near-rhymes':
        return NextResponse.json({ word, results: await dm({ rel_nry: word, md: 's' }) });
      case 'synonyms':
        return NextResponse.json({ word, results: await dm({ ml: word, md: 's' }) });
      case 'antonyms':
        return NextResponse.json({ word, results: await dm({ rel_ant: word, md: 's' }) });
      case 'related':
        return NextResponse.json({ word, results: await dm({ rel_trg: word, md: 's' }) });
      case 'syllables':
        return NextResponse.json({ word, results: await dm({ sp: word, md: 's' }) });
      case 'define':
        return NextResponse.json({ word, entries: await define(word) });
      default:
        return NextResponse.json({ error: 'unknown kind' }, { status: 400 });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'lookup failed';
    return NextResponse.json({ error: message || 'lookup failed' }, { status: 502 });
  }
}
