// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoleHomeTiles } from './RoleHomeTiles';
import { homeTiles } from '@/lib/labelos/role-view';
import { capabilitiesFor } from '@/lib/labelos/capabilities';

const owner = { kind: 'artist', role: 'owner', capabilities: new Set(capabilitiesFor('artist', 'owner', [])) };
const roster = { kind: 'label', role: 'artist', capabilities: new Set(capabilitiesFor('label', 'artist', [])) };

describe('RoleHomeTiles', () => {
  it('draws one link per tile, to the page, with the scoped song count only on My music', () => {
    render(<RoleHomeTiles tiles={homeTiles('nova', owner)} songCount={3} />);
    expect(screen.getByTestId('home-tile-music').getAttribute('href')).toBe('/o/nova/music');
    expect(screen.getByTestId('home-tile-earnings').getAttribute('href')).toBe('/o/nova/finance/earnings');
    expect(screen.getByTestId('home-tile-music-count').textContent).toBe('3 songs');
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });
  it('a roster artist has no money tile', () => {
    render(<RoleHomeTiles tiles={homeTiles('ns', roster)} songCount={1} />);
    expect(screen.queryByTestId('home-tile-earnings')).toBeNull();
    expect(screen.getByTestId('home-tile-music-count').textContent).toBe('1 song');
  });
  it('renders nothing without tiles', () => {
    const { container } = render(<RoleHomeTiles tiles={[]} />);
    expect(container.innerHTML).toBe('');
  });
});
