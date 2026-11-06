/**
 * The tiles of the artist-shaped homes (LABEL-70): "my music, my releases, my
 * money, my contracts" for an independent artist / producer, and the same
 * pages for a label's roster artist. Each tile is a plain link to a page the
 * person can open (`homeTiles` filters by `pageAllowed`); the only number is
 * the song count the server already scoped to this viewer.
 */
import Link from 'next/link';
import { Coins, Disc3, FileText, Music2, Palette, type LucideIcon } from 'lucide-react';
import type { HomeTile, OrgPage } from '@/lib/labelos/role-view';

const ICONS: Partial<Record<OrgPage, LucideIcon>> = { music: Music2, releases: Disc3, statements: Coins, contracts: FileText };

export function RoleHomeTiles({ tiles, songCount }: { tiles: readonly HomeTile[]; songCount?: number }) {
  if (tiles.length === 0) return null;
  return (
    <nav aria-label="Your work" data-testid="role-home" className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {tiles.map((t) => {
        const Icon = ICONS[t.page] ?? Music2;
        return (
          <Link
            key={t.page}
            href={t.href}
            data-testid={`home-tile-${t.page}`}
            className="group rounded-xl border border-white/10 bg-[#0D0D0A] p-4 transition-colors hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
          >
            <Icon size={16} strokeWidth={1.5} className="mb-3 text-white/40 transition-colors group-hover:text-white/70" aria-hidden="true" />
            <p className="font-heading text-[16px] font-bold leading-tight text-white/80">{t.label}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-white/60">{t.hint}</p>
            {t.page === 'music' && songCount !== undefined && (
              <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.2em] text-white/40" data-testid="home-tile-music-count">
                {songCount} {songCount === 1 ? 'song' : 'songs'}
              </p>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
