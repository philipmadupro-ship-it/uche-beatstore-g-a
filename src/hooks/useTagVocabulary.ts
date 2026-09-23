import { useQuery } from '@tanstack/react-query';
import type { VocabularyTag } from '@/lib/tags/vocabulary';

/**
 * The producer's own tag vocabulary — every custom tag they've used across the
 * catalogue, most-used first.
 *
 * Shared cache key with `useTags`, which invalidates it after any tag write so
 * a tag created on one track is immediately offered on the next.
 */
export const TAG_VOCABULARY_KEY = ['tag-vocabulary'] as const;

export function useTagVocabulary() {
  const { data: vocabulary = [], isLoading } = useQuery<VocabularyTag[]>({
    queryKey: TAG_VOCABULARY_KEY,
    queryFn: async () => {
      const res = await fetch('/api/tracks/tags');
      if (!res.ok) throw new Error('Failed to fetch tag vocabulary');
      const body = await res.json();
      return Array.isArray(body?.tags) ? body.tags : [];
    },
  });

  return { vocabulary, isLoading };
}
