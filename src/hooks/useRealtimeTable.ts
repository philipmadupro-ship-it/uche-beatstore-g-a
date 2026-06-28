'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Subscribe to Postgres CDC events on a single table (optionally filtered)
 * and call `onChange` whenever anything matching the filter mutates.
 *
 * Replaces the `setInterval(fetchX, 15_000)` pattern that several panels
 * were using before realtime. Cuts request volume to ~zero between real
 * events and makes new rows appear within ~1s instead of up to 15s.
 *
 * Channel naming: each subscriber gets a unique channel name (table +
 * filter + caller-id) so multiple instances on the same page don't share
 * a subscription and step on each other's unsubscribe.
 *
 * Caveats:
 *   - The callback receives no payload — we just signal "something
 *     changed; refetch". Avoids the trap of trying to keep client state
 *     in sync from CDC alone (deletes, RLS-driven updates, etc).
 *   - Requires Supabase Realtime to be enabled for the table at the
 *     project level. If it isn't, the subscription silently does
 *     nothing — the consumer's existing fetch-on-mount still works.
 */
export function useRealtimeTable(opts: {
  table: string;
  /** Postgres filter clause, e.g. `project_id=eq.<uuid>` or `track_id=eq.<uuid>`. */
  filter?: string;
  /** Disable subscription (e.g. when the parent has no id yet). */
  enabled?: boolean;
  /** Coalesce bursts of CDC events into one refresh. Defaults to 350ms. */
  debounceMs?: number;
  /** Caller-supplied callback. We keep a ref so consumers don't have to
   *  useCallback for hot identity — the subscription stays stable. */
  onChange: () => void;
}) {
  const { table, filter, enabled = true, debounceMs = 350, onChange } = opts;

  const cbRef = useRef(onChange);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { cbRef.current = onChange; }, [onChange]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    // Only set up realtime when the environment is configured. Otherwise
    // the createClient call will throw at runtime in pure-local dev.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anon) return;

    const supabase = createClient();
    const channelName = `${table}:${filter ?? 'all'}:${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, {
        event: '*',
        schema: 'public',
        table,
        filter,
      }, () => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          cbRef.current();
        }, Math.max(0, debounceMs));
      })
      .subscribe();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      // removeChannel is async but we don't need to await it on unmount.
      supabase.removeChannel(channel);
    };
  }, [table, filter, enabled, debounceMs]);
}
