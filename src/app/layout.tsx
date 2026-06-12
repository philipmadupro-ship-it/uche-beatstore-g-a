import type { Metadata, Viewport } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { Toaster } from '@/components/ui/Toaster';
import { CommandPalette } from '@/components/nav/CommandPalette';
import { ServiceWorkerRegistrar } from '@/components/providers/ServiceWorkerRegistrar';

// Akira Expanded, Synkopy, and Panchang are the primary UI fonts, loaded via @font-face in globals.css.

// PWA + mobile metadata. Next splits the modern metadata API across
// `metadata` (head tags) and `viewport` (theme-color, viewport, color-
// scheme) — separate exports so server components can statically emit
// each set. Together they give the app:
//   • "Add to Home Screen" install prompts on iOS / Android (manifest)
//   • Branded splash screen + chrome on standalone launch (apple meta)
//   • A theme-color matching the page bg so the iOS notch / Android
//     status-bar blend in instead of stripping cold-black
//   • Apple touch icon for the home-screen tile
export const metadata: Metadata = {
  title: "U2C Beatstore",
  description: "U2C's beat library, projects, sends, and studio — all in one place.",
  applicationName: "U2C Beatstore",
  manifest: '/manifest.json',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/icon.svg' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Beatstore',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  themeColor: '#090907',
  colorScheme: 'dark',
  // `viewportFit: cover` lets the page paint under the iOS notch /
  // home-indicator. We pair this with safe-area-inset padding on the
  // PlayerBar pill (already accounted for via bottom-3 spacing) so
  // controls never sit under the indicator.
  viewportFit: 'cover',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning on <html>/<body> because browser extensions
    // (Night Eye, Foxified, ColorZilla, dark-mode helpers, etc.) inject
    // attributes — `nighteye`, `foxified`, `cz-shortcut-listen`, extra
    // class tokens like `mdl-js` — into these tags before React hydrates.
    // The mismatch is noise from the extension, not a real SSR bug. The
    // suppression is scoped to the *top-level* attributes; mismatches in
    // children still throw normally.
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        suppressHydrationWarning
        className="font-sans bg-[#090907] text-[#F7EBDD] min-h-screen selection:bg-[#E7D7BE] selection:text-white"
      >
        <QueryProvider>
          {children}
          <CommandPalette />
          <Toaster />
          <ServiceWorkerRegistrar />
        </QueryProvider>
      </body>
    </html>
  );
}
