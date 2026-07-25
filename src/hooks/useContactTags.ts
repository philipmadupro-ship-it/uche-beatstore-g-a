import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tagNamesFromRows } from '@/lib/tags/rows';

export function useContactTags(contactId: string) {
  const qc = useQueryClient();
  const { data: tags = [], isLoading } = useQuery<string[]>({
    queryKey: ['contact-tags', contactId],
    queryFn: async () => {
      const res = await fetch(`/api/contacts/${contactId}/tags`);
      if (!res.ok) throw new Error('Failed to fetch contact tags');
      const rows = await res.json();
      return tagNamesFromRows(rows);
    },
  });
  const toggleTag = useMutation({
    mutationFn: async ({ tag, category, active }: { tag: string; category: string; active: boolean }) => {
      const res = await fetch(`/api/contacts/${contactId}/tags`, {
        method: active ? 'DELETE' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag, category }),
      });
      if (!res.ok) throw new Error('Toggle contact tag failed');
      return res.json();
    },
    onMutate: async ({ tag, active }) => {
      await qc.cancelQueries({ queryKey: ['contact-tags', contactId] });
      const previous = qc.getQueryData<string[]>(['contact-tags', contactId]) || [];
      qc.setQueryData<string[]>(['contact-tags', contactId], active ? previous.filter((t) => t !== tag) : [...previous, tag]);
      return { previous };
    },
    onError: (_e, _v, ctx) => { if (ctx) qc.setQueryData(['contact-tags', contactId], ctx.previous); },
    onSettled: () => { qc.invalidateQueries({ queryKey: ['contact-tags', contactId] }); },
  });
  return { tags, toggleTag, isLoading };
}
