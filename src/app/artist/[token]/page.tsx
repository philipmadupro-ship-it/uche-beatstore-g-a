import { ArtistPortal } from '@/components/artist-portal/ArtistPortal';

/**
 * /artist/[token] — one artist's permanent private portal (public by token).
 * Everything is decided by /api/portal/[token]; this page only renders it.
 */
export default async function ArtistPortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ArtistPortal token={token} />;
}
