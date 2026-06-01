import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function usePlaylistTags(playlistId: string) {
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useQuery<string[]>({
    queryKey: ['playlist-tags', playlistId],
    queryFn: async () => {
      const res = await fetch(`/api/playlists/${playlistId}/tags`);
      if (!res.ok) throw new Error('Failed to fetch playlist tags');
      const rows = await res.json();
      return Array.isArray(rows) ? rows.map((r: any) => r.tag) : [];
    },
  });
  const toggleTag = useMutation({
    mutationFn: async ({ tag, category, active }: { tag: string; category: string; active: boolean }) => {
      const res = await fetch(`/api/playlists/${playlistId}/tags`, {
        method: active ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, category }),
      });
      if (!res.ok) throw new Error('Toggle playlist tag failed');
      return res.json();
    },
    onMutate: async ({ tag, active }) => {
      await qc.cancelQueries({ queryKey: ['playlist-tags', playlistId] });
      const previous = qc.getQueryData<string[]>(['playlist-tags', playlistId]) || [];
      qc.setQueryData<string[]>(['playlist-tags', playlistId], active ? previous.filter((t) => t !== tag) : [...previous, tag]);
      return { previous };
    },
    onError: (_e, _v, ctx) => { if (ctx) qc.setQueryData(['playlist-tags', playlistId], ctx.previous); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['playlist-tags', playlistId] }); qc.invalidateQueries({ queryKey: ['playlists'] }); },
  });
  return { tags, toggleTag, isLoading };
}
