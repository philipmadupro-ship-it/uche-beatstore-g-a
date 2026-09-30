// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ProducerProfile } from './ProducerProfile';
import { ArtistBioBlock } from './ArtistBioBlock';

vi.mock('@/components/ui/MusicReactiveBackdrop', () => ({ MusicReactiveBackdrop: () => null }));
vi.mock('@/components/store/ParticleText', () => ({ ParticleText: () => null }));

afterEach(cleanup);

const messy = {
  display_name: 'Uche',
  instagram_handle: 'https://instagram.com/uche',
  twitter_handle: '@uche_x',
  website_url: 'uche.example',
  contact_email: 'hi@uche.example',
};
const hostile = {
  display_name: 'Uche',
  instagram_handle: 'a b',
  twitter_handle: 'javascript:alert(1)',
  website_url: 'javascript:alert(1)',
  contact_email: 'x@y.co?cc=z@w.co',
};

describe('ProducerProfile links', () => {
  it('resolves messy stored values to real destinations', () => {
    render(<ProducerProfile creator={messy} />);
    expect(screen.getByLabelText('Instagram').getAttribute('href')).toBe('https://instagram.com/uche');
    expect(screen.getByLabelText('X / Twitter').getAttribute('href')).toBe('https://x.com/uche_x');
    expect(screen.getByLabelText('Website').getAttribute('href')).toBe('https://uche.example');
    expect(screen.getByLabelText('Email').getAttribute('href')).toBe('mailto:hi@uche.example');
  });

  it('renders no link for values that are not usable', () => {
    const { container } = render(<ProducerProfile creator={hostile} />);
    expect(container.querySelectorAll('a[href^="javascript:"]').length).toBe(0);
    expect(screen.queryByLabelText('Instagram')).toBeNull();
    expect(screen.queryByLabelText('Website')).toBeNull();
    expect(screen.queryByLabelText('Email')).toBeNull();
  });
});

describe('ArtistBioBlock (storefront hero) links', () => {
  it('resolves every kind, including bare-domain Spotify / SoundCloud', () => {
    render(<ArtistBioBlock plainTitle creator={{ ...messy, spotify_url: 'open.spotify.com/artist/a', soundcloud_url: 'soundcloud.com/me' } as never} />);
    expect(screen.getByLabelText('Instagram').getAttribute('href')).toBe('https://instagram.com/uche');
    expect(screen.getByLabelText('X / Twitter').getAttribute('href')).toBe('https://x.com/uche_x');
    expect(screen.getByLabelText('Spotify').getAttribute('href')).toBe('https://open.spotify.com/artist/a');
    expect(screen.getByLabelText('SoundCloud').getAttribute('href')).toBe('https://soundcloud.com/me');
    expect(screen.getByLabelText('Website').getAttribute('href')).toBe('https://uche.example');
    expect(screen.getByLabelText('hi@uche.example').getAttribute('href')).toBe('mailto:hi@uche.example');
  });

  it('drops hostile values instead of linking them', () => {
    const { container } = render(<ArtistBioBlock plainTitle creator={{ ...hostile, spotify_url: 'data:text/html,x' } as never} />);
    expect(container.querySelectorAll('a[href^="javascript:"], a[href^="data:"], a[href^="mailto:"]').length).toBe(0);
    expect(screen.queryByLabelText('Website')).toBeNull();
  });
});
