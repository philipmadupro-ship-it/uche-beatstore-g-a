/**
 * Turn a pasted video link into an embeddable player URL — YouTube or Vimeo
 * only. The storefront enforces its CSP, so any other origin would render as a
 * blocked frame; better to say "not supported" in the editor than ship a grey
 * box to buyers. Watch/share links are converted, so producers can paste the
 * link they already have instead of hunting for the embed code.
 */
export function toVideoEmbed(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

  const yt = (id: string | null | undefined) =>
    id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null;
  if (host === 'youtu.be') return yt(url.pathname.slice(1));
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return yt(url.searchParams.get('v'));
    const m = url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/);
    return yt(m?.[1]);
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const m = url.pathname.match(/(?:\/video)?\/(\d{5,12})/);
    return m ? `https://player.vimeo.com/video/${m[1]}` : null;
  }
  return null;
}
