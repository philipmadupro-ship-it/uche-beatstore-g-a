// @vitest-environment jsdom

/**
 * The Beat Listing row decides what is on sale and for how much. The failures
 * worth guarding are the quiet ones: a blank price saved as $0 (publishing a
 * catalogue for free), a control that appears on a draft where it does
 * nothing, and a price that appears to save when the PATCH was rejected.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { StoreBeatRow, type StoreBeatRowTrack } from './StoreBeatRow';

vi.mock('@/lib/upload/image-upload-client', () => ({ uploadImageFile: vi.fn() }));

afterEach(cleanup);

const beat = (over: Partial<StoreBeatRowTrack> = {}): StoreBeatRowTrack => ({
  id: 't1',
  title: 'Midnight',
  type: 'beat',
  cover_url: null,
  bpm: 140,
  key: 'F#',
  store_listed: true,
  store_featured: false,
  lease_price_usd: 30,
  free_download_enabled: false,
  voice_tag_enabled: false,
  scheduled_publish_at: null,
  ...over,
});

function renderRow(over: Partial<StoreBeatRowTrack> = {}, props: Partial<Parameters<typeof StoreBeatRow>[0]> = {}) {
  const onPatch = vi.fn().mockResolvedValue(true);
  const handlers = {
    onToggleListed: vi.fn(), onToggleFeatured: vi.fn(), onToggleFreeDownload: vi.fn(),
    onToggleVoiceTag: vi.fn(), onToggleLicensePanel: vi.fn(), onMove: vi.fn(),
    onSetSchedule: vi.fn(),
  };
  render(
    <StoreBeatRow
      track={beat(over)}
      listedIndex={over.store_listed === false ? -1 : 0}
      listedCount={3}
      licensePanelOpen={false}
      voiceTagConfigured
      onPatch={onPatch}
      {...handlers}
      {...props}
    />,
  );
  return { onPatch, ...handlers };
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'Options for Midnight' }));

describe('StoreBeatRow', () => {
  it('keeps the listed toggle as the one always-visible control', () => {
    renderRow();
    const toggle = screen.getByRole('switch', { name: 'Remove Midnight from store' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('saves a typed lease price', async () => {
    const { onPatch } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Lease price for Midnight' }));
    const input = screen.getByLabelText('Lease price for Midnight');
    fireEvent.change(input, { target: { value: '49.99' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ lease_price_usd: 49.99 }));
  });

  it('saves a cleared price as null (inherit default), never as zero', async () => {
    const { onPatch } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Lease price for Midnight' }));
    const input = screen.getByLabelText('Lease price for Midnight');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ lease_price_usd: null }));
  });

  it('refuses a nonsense price and does not PATCH', async () => {
    const { onPatch } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Lease price for Midnight' }));
    const input = screen.getByLabelText('Lease price for Midnight');
    fireEvent.change(input, { target: { value: '-5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.getByLabelText('Lease price for Midnight')).toBeTruthy());
    expect(onPatch).not.toHaveBeenCalled();
  });

  it('renames in place', async () => {
    const { onPatch } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Title of Midnight' }));
    const input = screen.getByLabelText('Title of Midnight');
    fireEvent.change(input, { target: { value: 'Midnight II' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onPatch).toHaveBeenCalledWith({ title: 'Midnight II' }));
  });

  it('offers a cover change without leaving the page', () => {
    renderRow();
    expect(screen.getByRole('button', { name: 'Change cover for Midnight' })).toBeTruthy();
  });

  /**
   * A menu row is `menuitem` or, when it carries a check mark, `menuitemcheckbox`.
   * Asserting on one role alone makes a `queryBy…().toBeNull()` pass for the
   * wrong reason — the row is there, just under the other role.
   */
  const menuRow = (name: RegExp | string) =>
    screen.queryByRole('menuitem', { name }) ?? screen.queryByRole('menuitemcheckbox', { name });

  it('hides listing-only actions on a draft, and offers scheduling instead', () => {
    renderRow({ store_listed: false });
    openMenu();
    expect(menuRow(/Producer's Picks/)).toBeNull();
    expect(menuRow(/free download/i)).toBeNull();
    expect(menuRow(/Schedule auto-publish/)).toBeTruthy();
  });

  it('offers listing actions on a live beat, and no scheduling', () => {
    renderRow();
    openMenu();
    expect(menuRow(/Producer's Picks/)).toBeTruthy();
    expect(menuRow(/auto-publish/i)).toBeNull();
  });

  it('disables the voice tag item until a voice tag exists', () => {
    renderRow({}, { voiceTagConfigured: false });
    openMenu();
    const item = menuRow(/voice tag/i)!;
    expect(item.hasAttribute('disabled')).toBe(true);
    expect(item.textContent).toContain('Upload a voice tag first');
  });

  it('disables Move up on the first listed beat', () => {
    renderRow();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'Move up' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('menuitem', { name: 'Move down' }).hasAttribute('disabled')).toBe(false);
  });

  it('reads a listed beat as live even with a schedule still on the row', () => {
    renderRow({ scheduled_publish_at: '2026-09-01T00:00:00.000Z' });
    expect(screen.getByText('live')).toBeTruthy();
  });

  it('shows the inherited default as the price placeholder when unset', () => {
    renderRow({ lease_price_usd: null }, { defaultLeasePrice: 25 });
    expect(screen.getByRole('button', { name: 'Edit Lease price for Midnight' }).textContent)
      .toContain('$25 (default)');
  });
});
