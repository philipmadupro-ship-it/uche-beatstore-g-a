import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/**
 * Project tag state — mirrors useTags but for projects (mig 081). The API
 * returns { tag, category } objects; we expose the tag-name list for the
 * picker's `includes()` checks and invalidate ['projects'] so the list's
 * tag chips/filters stay fresh.
 */
export function useProjectTags(projectId: string) {
  const qc = useQueryClient();

  const { data: tags = [], isLoading } = useQuery<string[]>({
    queryKey: ['project-tags', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/tags`);
      if (!res.ok) throw new Error('Failed to fetch project tags');
      const rows = await res.json();
      return Array.isArray(rows) ? rows.map((r: { tag: string }) => r.tag) : [];
    },
  });

  const toggleTag = useMutation({
    mutationFn: async ({ tag, category, active }: { tag: string; category: string; active: boolean }) => {
      const method = active ? 'DELETE' : 'POST';
      const res = await fetch(`/api/projects/${projectId}/tags`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, category }),
      });
      if (!res.ok) throw new Error('Toggle project tag failed');
      return res.json();
    },
    onMutate: async ({ tag, active }) => {
      await qc.cancelQueries({ queryKey: ['project-tags', projectId] });
      const previous = qc.getQueryData<string[]>(['project-tags', projectId]) || [];
      qc.setQueryData<string[]>(['project-tags', projectId],
        active ? previous.filter((t) => t !== tag) : [...previous, tag]);
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) qc.setQueryData(['project-tags', projectId], ctx.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['project-tags', projectId] });
      qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  return { tags, toggleTag, isLoading };
}
