import type { DurationBucket, SortBy } from './filters';

type StoreUrlTypeFilter = 'all' | 'beats' | 'song' | 'remix';

const TYPE_FILTERS: StoreUrlTypeFilter[] = ['all', 'beats', 'song', 'remix'];
const SORT_VALUES: SortBy[] = ['newest', 'popular', 'bpm-asc', 'bpm-desc', 'price-asc', 'price-desc', 'title'];
const SCALE_VALUES = ['major', 'minor'] as const;
const DURATION_VALUES: DurationBucket[] = ['', 'short', 'medium', 'long'];

export const STORE_FILTER_QUERY_KEYS = [
  'q',
  'type',
  'genre',
  'mood',
  'key',
  'scale',
  'duration',
  'free',
  'favorites',
  'new',
  'sort',
  'bpm_min',
  'bpm_max',
  'price_min',
  'price_max',
] as const;

export type StoreUrlFilters = {
  searchQuery: string;
  typeFilter: StoreUrlTypeFilter;
  genreFilter: string;
  moodFilter: string;
  keyFilter: string;
  scaleFilter: '' | 'major' | 'minor';
  durationBucket: DurationBucket;
  freeOnly: boolean;
  favoritesOnly: boolean;
  newThisWeek: boolean;
  sortBy: SortBy;
  bpmMin: number | null;
  bpmMax: number | null;
  priceMin: number | null;
  priceMax: number | null;
};

export type StoreUrlFilterInput = Omit<StoreUrlFilters, 'bpmMin' | 'bpmMax' | 'priceMin' | 'priceMax'> & {
  bpmMin: number;
  bpmMax: number;
  priceMin: number;
  priceMax: number;
  bpmRangeActive: boolean;
  priceRangeActive: boolean;
};

function readString(params: URLSearchParams, key: string) {
  return (params.get(key) ?? '').trim();
}

function readNumber(params: URLSearchParams, key: string) {
  const raw = params.get(key);
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : null;
}

export function parseStoreFilterParams(params: URLSearchParams): StoreUrlFilters {
  const type = readString(params, 'type');
  const scale = readString(params, 'scale');
  const duration = readString(params, 'duration');
  const sort = readString(params, 'sort');

  return {
    searchQuery: readString(params, 'q'),
    typeFilter: TYPE_FILTERS.includes(type as StoreUrlTypeFilter) ? (type as StoreUrlTypeFilter) : 'all',
    genreFilter: readString(params, 'genre'),
    moodFilter: readString(params, 'mood'),
    keyFilter: readString(params, 'key'),
    scaleFilter: SCALE_VALUES.includes(scale as 'major' | 'minor') ? (scale as 'major' | 'minor') : '',
    durationBucket: DURATION_VALUES.includes(duration as DurationBucket) ? (duration as DurationBucket) : '',
    freeOnly: params.get('free') === '1',
    favoritesOnly: params.get('favorites') === '1',
    newThisWeek: params.get('new') === '1',
    sortBy: SORT_VALUES.includes(sort as SortBy) ? (sort as SortBy) : 'newest',
    bpmMin: readNumber(params, 'bpm_min'),
    bpmMax: readNumber(params, 'bpm_max'),
    priceMin: readNumber(params, 'price_min'),
    priceMax: readNumber(params, 'price_max'),
  };
}

export function buildStoreFilterParams(baseParams: URLSearchParams, filters: StoreUrlFilterInput): URLSearchParams {
  const next = new URLSearchParams(baseParams);
  STORE_FILTER_QUERY_KEYS.forEach((key) => next.delete(key));

  const q = filters.searchQuery.trim();
  if (q) next.set('q', q);
  if (filters.typeFilter !== 'all') next.set('type', filters.typeFilter);
  if (filters.genreFilter) next.set('genre', filters.genreFilter);
  if (filters.moodFilter) next.set('mood', filters.moodFilter);
  if (filters.keyFilter) next.set('key', filters.keyFilter);
  if (filters.scaleFilter) next.set('scale', filters.scaleFilter);
  if (filters.durationBucket) next.set('duration', filters.durationBucket);
  if (filters.freeOnly) next.set('free', '1');
  if (filters.favoritesOnly) next.set('favorites', '1');
  if (filters.newThisWeek) next.set('new', '1');
  if (filters.sortBy !== 'newest') next.set('sort', filters.sortBy);
  if (filters.bpmRangeActive) {
    next.set('bpm_min', String(filters.bpmMin));
    next.set('bpm_max', String(filters.bpmMax));
  }
  if (filters.priceRangeActive) {
    next.set('price_min', String(filters.priceMin));
    next.set('price_max', String(filters.priceMax));
  }

  return next;
}
