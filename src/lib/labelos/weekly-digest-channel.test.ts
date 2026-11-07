import { describe, expect, it } from 'vitest';
import { capabilitiesFor } from './capabilities';
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
});
