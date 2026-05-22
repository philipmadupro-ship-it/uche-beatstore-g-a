'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

// Defaults tuned for a Spotify-style "feels instant" feel:
//   staleTime 30s          → revisiting a screen shows cached data immediately,
//                            no spinner, while a quiet background refetch updates it
//   refetchOnWindowFocus   → off; the realtime subscription already invalidates,
//                            and focus-refetch causes annoying flicker on tab switch
//   gcTime 5 min           → keep entries around long enough that back/forward nav
//                            never has to refetch from scratch
//   retry 1                → one retry on network blip, no thrash on real failures
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
