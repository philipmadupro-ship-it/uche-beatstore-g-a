/**
 * Keep only the profile columns a request actually named.
 *
 * `/api/profile` builds a normalised row from the body (`x || null` for every
 * column) and upserts it. Upsert only touches the columns it is given — but the
 * route used to give it ALL of them, so a request that named one field wrote
 * NULL into every other one. The brand-artwork card sends one slot at a time,
 * so uploading a project image wiped the logo, the other artwork, the bio and
 * reset the accent colour: "the brand settings replace themselves".
 *
 * A palette column also counts as named when its image column is: clearing an
 * image must clear its colours, or the next upload inherits them.
 */
const PALETTE_OF: Record<string, string> = {
  default_artwork_palette: 'default_artwork_url',
  default_artwork_project_palette: 'default_artwork_project_url',
  default_artwork_playlist_palette: 'default_artwork_playlist_url',
};

export function pickProvidedProfileFields<T extends Record<string, unknown>>(
  payload: T,
  body: Record<string, unknown>,
): Partial<T> {
  const named = (key: string) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
  const out: Partial<T> = {};
  for (const key of Object.keys(payload) as Array<keyof T & string>) {
    const urlKey = PALETTE_OF[key];
    if (named(key) || (urlKey && named(urlKey))) out[key] = payload[key];
  }
  return out;
}
