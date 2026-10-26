// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { FeedEvent } from '@/lib/labelos/activity-feed';
import type { DigestNames } from '@/lib/labelos/digest';
import { ActivityDigestView, dayLabel } from './ActivityDigestView';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

afterEach(cleanup);

const SAM = 'sam';
const NOVA = 'nova';
const names: DigestNames = { actors: { [SAM]: 'Sam' }, artists: { [NOVA]: 'Nova' }, releases: {} };

let n = 0;
const ev = (over: Partial<FeedEvent> & Pick<FeedEvent, 'verb' | 'at'>): FeedEvent => {
  n += 1;
  return { id: `e${n}`, actorId: SAM, artistId: NOVA, projectId: null, songId: null, releaseId: null, subjectType: null, subjectId: `s${n}`, visibility: 'artist', summary: {}, ...over };
};

describe('ActivityDigestView', () => {
  it('draws 10 uploads within 10 minutes as ONE line, under the artist', () => {
    const events = Array.from({ length: 10 }, (_, i) => ev({ verb: 'song.created', at: `2026-10-05T09:0${i}:00.000Z`, summary: { stage: 'inbox' } }));
    render(<ActivityDigestView events={events} names={names} view="overview" orgSlug="acme" />);
    const lines = screen.getAllByTestId('digest-line');
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toContain('Sam added 10 demos');
    expect(screen.getByTestId(`digest-artist-${NOVA}`).getAttribute('href')).toBe('/o/acme/artists/nova');
  });

  it('says "You" for the viewer’s own lines', () => {
    render(<ActivityDigestView events={[ev({ verb: 'song.created', at: '2026-10-05T09:00:00.000Z' })]} names={names} view="overview" orgSlug="acme" viewerId={SAM} />);
    expect(screen.getByTestId('digest-line').textContent).toContain('You added a song');
  });

  it('files project-only events under the project’s artist, and organization events last', () => {
    const events = [
      ev({ verb: 'file.uploaded', at: '2026-10-05T10:00:00.000Z', artistId: null, projectId: 'p1' }),
      ev({ verb: 'member.removed', at: '2026-10-05T11:00:00.000Z', artistId: null, visibility: 'internal' }),
    ];
    render(<ActivityDigestView events={events} names={names} projectArtists={{ p1: [NOVA] }} view="overview" orgSlug="acme" />);
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Nova', 'Organization']);
  });

  it('has no artist headings in the artist view, and day labels', () => {
    render(<ActivityDigestView events={[ev({ verb: 'song.created', at: '2026-09-14T09:00:00.000Z' })]} names={names} view="artist" orgSlug="acme" />);
    expect(screen.queryAllByRole('heading', { level: 3 })).toEqual([]);
    expect(screen.getByTestId('digest-day-2026-09-14').textContent).toBe('Mon 14 Sep');
  });

  it('says restricted as a number, never a title', () => {
    render(<ActivityDigestView events={[]} names={names} view="overview" orgSlug="acme" restricted={2} />);
    expect(within(screen.getByTestId('digest-restricted')).getByText(/2 updates on songs you can’t see yet: restricted/)).toBeTruthy();
  });

  it('names no one by id or email: an unknown actor is "A team member"', () => {
    render(<ActivityDigestView events={[ev({ verb: 'song.created', at: '2026-10-05T09:00:00.000Z', actorId: 'someone-else' })]} names={names} view="overview" orgSlug="acme" />);
    expect(screen.getByTestId('digest-line').textContent).toContain('A team member added a song');
    expect(screen.getByTestId('digest-line').textContent).not.toContain('someone-else');
  });
});

describe('dayLabel', () => {
  const now = new Date('2026-10-06T12:00:00Z');
  it('is Today / Yesterday / a dated label in the given zone', () => {
    expect(dayLabel('2026-10-06', now, 'UTC')).toBe('Today');
    expect(dayLabel('2026-10-05', now, 'UTC')).toBe('Yesterday');
    expect(dayLabel('2026-10-01', now, 'UTC')).toBe('Thu 1 Oct');
    expect(dayLabel('2026-10-06', new Date('2026-10-05T23:30:00Z'), 'Europe/Paris')).toBe('Today');
  });
});
