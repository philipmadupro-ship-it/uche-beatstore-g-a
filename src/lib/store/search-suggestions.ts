import type { StoreTrack } from './filters';

export type StoreSearchSuggestionKind = 'recent' | 'track' | 'genre' | 'mood' | 'key' | 'tag';

export type StoreSearchSuggestion = {
  kind: StoreSearchSuggestionKind;
  value: string;
  label: string;
  hint?: string;
};

export const MAX_RECENT_STORE_SEARCHES = 6;

function normalized(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function matchesQuery(value: string, query: string) {
  if (!query) return true;
  return value.toLowerCase().includes(query.toLowerCase());
}

function uniquePush(
  suggestions: StoreSearchSuggestion[],
  seen: Set<string>,
  suggestion: StoreSearchSuggestion,
) {
  const key = `${suggestion.kind}:${suggestion.value.toLowerCase()}`;
  if (seen.has(key) || !suggestion.value.trim()) return;
  seen.add(key);
  suggestions.push(suggestion);
}

export function normalizeRecentStoreSearches(values: string[], limit = MAX_RECENT_STORE_SEARCHES) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const raw of values) {
    const value = normalized(raw);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= limit) break;
  }
  return output;
}

export function addRecentStoreSearch(values: string[], nextValue: string, limit = MAX_RECENT_STORE_SEARCHES) {
  const value = normalized(nextValue);
  if (!value) return normalizeRecentStoreSearches(values, limit);
  return normalizeRecentStoreSearches([value, ...values], limit);
}

export function buildStoreSearchSuggestions({
  query,
  tracks,
  genres,
  moods,
  keys,
  recentSearches,
  limit = 8,
}: {
  query: string;
  tracks: StoreTrack[];
  genres: string[];
  moods: string[];
  keys: string[];
  recentSearches: string[];
  limit?: number;
}): StoreSearchSuggestion[] {
  const q = normalized(query);
  const suggestions: StoreSearchSuggestion[] = [];
  const seen = new Set<string>();

  for (const term of recentSearches) {
    if (!matchesQuery(term, q)) continue;
    uniquePush(suggestions, seen, {
      kind: 'recent',
      value: term,
      label: term,
      hint: 'Recent',
    });
    if (suggestions.length >= limit) return suggestions;
  }

  const candidateTracks = [...tracks]
    .filter((track) => matchesQuery(track.title, q))
    .sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0) || a.title.localeCompare(b.title))
    .slice(0, 3);
  for (const track of candidateTracks) {
    uniquePush(suggestions, seen, {
      kind: 'track',
      value: track.title,
      label: track.title,
      hint: [track.bpm ? `${track.bpm} BPM` : null, track.key].filter(Boolean).join(' · ') || 'Beat',
    });
    if (suggestions.length >= limit) return suggestions;
  }

  for (const genre of genres.filter((item) => matchesQuery(item, q)).slice(0, 3)) {
    uniquePush(suggestions, seen, { kind: 'genre', value: genre, label: genre, hint: 'Genre' });
    if (suggestions.length >= limit) return suggestions;
  }

  for (const mood of moods.filter((item) => matchesQuery(item, q)).slice(0, 3)) {
    uniquePush(suggestions, seen, { kind: 'mood', value: mood, label: mood, hint: 'Mood' });
    if (suggestions.length >= limit) return suggestions;
  }

  for (const key of keys.filter((item) => matchesQuery(item, q)).slice(0, 3)) {
    uniquePush(suggestions, seen, { kind: 'key', value: key, label: key, hint: 'Key' });
    if (suggestions.length >= limit) return suggestions;
  }

  const tags = new Set<string>();
  tracks.forEach((track) => {
    (track.tags ?? []).forEach((tag) => {
      if (matchesQuery(tag.tag, q)) tags.add(tag.tag);
    });
  });
  for (const tag of Array.from(tags).sort().slice(0, 3)) {
    uniquePush(suggestions, seen, { kind: 'tag', value: tag, label: tag, hint: 'Tag' });
    if (suggestions.length >= limit) return suggestions;
  }

  return suggestions;
}
