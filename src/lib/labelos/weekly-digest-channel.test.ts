import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
import { eventVisibleTo } from './activity-feed';
import { channelAccessFor, CHANNEL_WITHHELD_CAPABILITIES } from './weekly-digest-store';

describe('Slack channel view (LABEL-74)', () => {
  it('drops internal events, working material and legal data from an owner’s access', () => {
    const owner = capabilitiesFor('label', 'owner', []);
    for (const c of CHANNEL_WITHHELD_CAPABILITIES) expect(owner.has(c as never)).toBe(true);
    const view = channelAccessFor({ capabilities: owner, role: 'owner' });
    for (const c of CHANNEL_WITHHELD_CAPABILITIES) expect(view.capabilities.has(c as never)).toBe(false);
    expect(view.capabilities.has('catalog.read' as never)).toBe(true);
    expect(view.role).toBe('owner');
  });

  // G18: the loop above reads the very constant it checks, so emptying the constant passed. These pin the policy itself.
  it('withholds exactly the capabilities that carry internal events, working audio and rights detail', () => {
    expect([...CHANNEL_WITHHELD_CAPABILITIES].sort()).toEqual(['audio.working', 'business.read.internal', 'rights.read']);
  });

  it('an owner’s channel view reads artist-visible events and no internal one', () => {
    const owner = capabilitiesFor('label', 'owner', []);
    const full = { capabilities: owner, artistScope: null, projectsInScope: null };
    const channel = { ...full, capabilities: channelAccessFor({ capabilities: owner }).capabilities };
    const internal = { visibility: 'internal', artistId: null, projectId: null };
    const artist = { visibility: 'artist', artistId: null, projectId: null };
    expect(eventVisibleTo(full, internal)).toBe(true);
    expect(eventVisibleTo(channel, internal)).toBe(false);
    expect(eventVisibleTo(channel, artist)).toBe(true);
  });
});
