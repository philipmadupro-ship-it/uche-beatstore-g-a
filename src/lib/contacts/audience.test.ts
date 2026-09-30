import { describe, expect, it } from 'vitest';
import { searchArtists, splitContacts } from './audience';
import type { ArtistSummary } from './artist-summary';

const artist = (id: string, name: string, projects: string[], stage: ArtistSummary['relationship']['stage'] = 'engaged'): ArtistSummary => ({
  contact: { id, name, avatar_url: null },
  relationship: { stage, parked: null } as ArtistSummary['relationship'],
  activeProject: null,
  projectCount: projects.length,
  projectNames: projects,
  decisions: {},
  moving: 0,
  plays: 0,
  downloads: 0,
  portal: null,
  notifyCount: 0,
});

describe('splitContacts', () => {
  it('puts each contact in exactly one audience', () => {
    const { artists, others } = splitContacts([{ id: 'a' }, { id: 'b' }, { id: 'c' }], new Set(['b']));
    expect(artists.map((c) => c.id)).toEqual(['b']);
    expect(others.map((c) => c.id)).toEqual(['a', 'c']);
  });
});

describe('searchArtists', () => {
  const list = [artist('1', 'Nova', ['Midnight EP']), artist('2', 'Kofi Béla', ['Summer Tape'], 'working_together')];
  it('matches name, project and stage, every word, accent-insensitive', () => {
    expect(searchArtists(list, 'bela').map((a) => a.contact.id)).toEqual(['2']);
    expect(searchArtists(list, 'midnight').map((a) => a.contact.id)).toEqual(['1']);
    expect(searchArtists(list, 'summer kofi').map((a) => a.contact.id)).toEqual(['2']);
    expect(searchArtists(list, 'summer nova')).toEqual([]);
    expect(searchArtists(list, '  ')).toHaveLength(2);
  });
});
