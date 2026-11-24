// @vitest-environment jsdom

/**
 * Below md the picker and the preview stack. A half-height picker above the
 * preview overlapped it, so the Preview tab shows only the preview (the picker
 * is `hidden md:flex`), and Compose keeps the picker beside/above the form.
 * jsdom has no layout, so this asserts the responsive classes that decide it.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { SendBeatModal } from './SendBeatModal';
import type { Contact } from '@/lib/types';

const contact = { id: 'c1', name: 'Ada', email: 'ada@example.com' } as unknown as Contact;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('/api/projects') ? { projects: [] } : String(url).includes('/api/email') ? { from: 'a@b.c', producerName: 'Uche' } : []),
  })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('SendBeatModal narrow layout', () => {
  it('shows the picker on Compose and hides it on Preview below md', async () => {
    render(<SendBeatModal contact={contact} onClose={() => {}} onSuccess={() => {}} />);
    const pane = await screen.findByTestId('send-picker-pane');
    await waitFor(() => expect(pane.className).toMatch(/\bflex\b/));
    expect(pane.className).not.toMatch(/\bhidden\b/);

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    const after = screen.getByTestId('send-picker-pane');
    expect(after.className).toMatch(/\bhidden\b/);
    expect(after.className).toMatch(/\bmd:flex\b/);

    fireEvent.click(screen.getByRole('button', { name: /compose/i }));
    expect(screen.getByTestId('send-picker-pane').className).not.toMatch(/\bhidden\b/);
  });
});
