import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/hooks/useToast';
import { TAG_VOCABULARY_KEY } from '@/hooks/useTagVocabulary';

export function useTags(trackId: string) {
  const qc = useQueryClient();

  const { data: tags = [], isLoading } = useQuery<string[]>({
    queryKey: ['tags', trackId],
    // The drawer mounts its hooks unconditionally (its `track` can be null
    // mid-session), so it passes '' rather than skipping the hook. Don't turn
    // that into a request for `/api/tracks//tags`.
    enabled: !!trackId,
    queryFn: async () => {
      const res = await fetch(`/api/tracks/${trackId}/tags`);
      if (!res.ok) throw new Error('Failed to fetch tags');
      return res.json();
    },
  });

  const toggleTag = useMutation({
    mutationFn: async ({ tag, category, active }: { tag: string; category: string; active: boolean }) => {
      const method = active ? 'DELETE' : 'POST';
      const res = await fetch(`/api/tracks/${trackId}/tags`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, category }),
      });
      if (!res.ok) throw new Error('Toggle tag failed');
      return res.json();
    },
    onMutate: async ({ tag, active }) => {
      await qc.cancelQueries({ queryKey: ['tags', trackId] });
      const previousTags = qc.getQueryData<string[]>(['tags', trackId]) || [];
      
      const newTags = active 
        ? previousTags.filter(t => t !== tag)
        : [...previousTags, tag];

      qc.setQueryData(['tags', trackId], newTags);
      return { previousTags };
    },
    onError: (err, variables, context) => {
      if (context) qc.setQueryData(['tags', trackId], context.previousTags);
      // Without this the chip fills, the request fails, the chip empties, and
      // the only story available to the user is "tags don't save". Same
      // lesson as useRating — an optimistic write owes the user an error.
      toast.error(
        variables.active ? 'Couldn’t remove tag' : 'Couldn’t save tag',
        err instanceof Error ? err.message : undefined,
      );
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tags', trackId] });
      qc.invalidateQueries({ queryKey: ['tracks'] });
      // A newly created custom tag has to join the producer's vocabulary
      // straight away, or it stays invisible everywhere except this track.
      qc.invalidateQueries({ queryKey: TAG_VOCABULARY_KEY });
    },
  });

  return { tags, toggleTag, isLoading };
}
