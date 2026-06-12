export const TAG_TAXONOMY = {
  genre:       ['Trap','Drill','Afrobeats','Amapiano','R&B','Hip-hop','UK Drill','Jersey Club','Dancehall','Lo-fi','Pluggnb','Pop'],
  mood:        ['Dark','Melodic','Aggressive','Chill','Emotional','Hype','Romantic','Cinematic','Eerie'],
  instruments: ['808s','Piano','Guitar','Strings','Flute','Vocal sample','Brass','Synth','Bells'],
  status:      ['Ready to send','Needs mix','Reference only','Exclusive','Leased','In use'],
} as const;

export type TagCategory = keyof typeof TAG_TAXONOMY;

// Project-only tag vocabulary. Kept separate from TAG_TAXONOMY so these never
// leak into the per-track tagging UIs. Persisted under category 'project_type'
// in project_tags. Projects also reuse the genre/mood vocab above for filtering.
export const PROJECT_TYPE_OPTIONS = [
  'Album', 'EP', 'Single', 'Mixtape', 'Beat tape', 'Loop kit',
  'Client', 'Demo', 'Released', 'WIP',
] as const;
export type ProjectTypeTag = (typeof PROJECT_TYPE_OPTIONS)[number];

// Collection-level content buckets used when creating projects/playlists and
// when filtering cover-art collections. Kept out of per-track tag UIs.
export const CONTENT_BUCKET_OPTIONS = ['Beats', 'Instrumentals', 'Songs', 'Remixes'] as const;
export type ContentBucketTag = (typeof CONTENT_BUCKET_OPTIONS)[number];
