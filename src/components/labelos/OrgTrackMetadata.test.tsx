// @vitest-environment jsdom

/**
 * The metadata editor form (LABEL-53): loads with the member's writable
 * fields, sends only what changed with the token it loaded with, names a
 * refused field under that field, and on a 409 says someone else saved first
 * and keeps the typed text until the member takes the current values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { OrgTrackMetadata } from './OrgTrackMetadata';
import { METADATA_FIELDS, type MetadataValues } from '@/lib/labelos/track-metadata';

const VALUES: MetadataValues = {
  title: 'Midnight', version_label: null, isrc: null, iswc: null, bpm: null, key: null, language: null,
  explicit: null, genre: null, recorded_on: null, p_line: null, master_owner: null, notes: null,
};

let load: { status: number; body: unknown };
let patchReply: { status: number; body: unknown };
let patches: unknown[];

beforeEach(() => {
  patches = [];
  load = { status: 200, body: { trackId: 't1', kind: 'recording', values: VALUES, updatedAt: null, writable: [...METADATA_FIELDS] } };
  patchReply = { status: 200, body: { changed: ['isrc'], values: { ...VALUES, isrc: 'GBAAA2600001' }, updatedAt: '2026-10-19T10:00:00.000Z' } };
  vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
    const r = init?.method === 'PATCH' ? patchReply : load;
    if (init?.method === 'PATCH') patches.push(JSON.parse(String(init.body)));
    return { ok: r.status < 400, status: r.status, json: async () => r.body } as Response;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const type = (label: RegExp | string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe('OrgTrackMetadata', () => {
  it('sets an ISRC: sends only that field with the loaded token', async () => {
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    await screen.findByLabelText('ISRC');
    expect((screen.getByTestId('org-metadata-save') as HTMLButtonElement).disabled).toBe(true);
    type('ISRC', 'GB-AAA-26-00001');
    fireEvent.click(screen.getByTestId('org-metadata-save'));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ expected: null, isrc: 'GB-AAA-26-00001' });
    await waitFor(() => expect((screen.getByTestId('org-metadata-save') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByLabelText('ISRC') as HTMLInputElement).value).toBe('GBAAA2600001');
  });

  it('a recording has no ISWC field; a song does', async () => {
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    await screen.findByLabelText('ISRC');
    expect(screen.queryByLabelText('ISWC')).toBeNull();
    cleanup();
    load = { status: 200, body: { trackId: 't1', kind: 'song', values: VALUES, updatedAt: null, writable: [...METADATA_FIELDS] } };
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    expect(await screen.findByLabelText('ISWC')).toBeTruthy();
  });

  it('shows a field the member may not change read-only, and never sends it', async () => {
    load = { status: 200, body: { trackId: 't1', kind: 'recording', values: VALUES, updatedAt: null, writable: METADATA_FIELDS.filter((f) => f !== 'isrc') } };
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    const isrc = await screen.findByLabelText('ISRC');
    expect((isrc as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Your role cannot change the ISRC.')).toBeTruthy();
  });

  it('puts a refusal under the field it names', async () => {
    patchReply = { status: 400, body: { error: 'isrc: not a valid ISRC (CC-XXX-YY-NNNNN)', field: 'isrc' } };
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    await screen.findByLabelText('ISRC');
    type('ISRC', 'nope');
    fireEvent.click(screen.getByTestId('org-metadata-save'));
    expect((await screen.findByTestId('org-metadata-isrc-error')).textContent).toMatch(/not a valid ISRC/);
    expect((screen.getByLabelText('ISRC') as HTMLInputElement).value).toBe('nope');
  });

  it('on a conflict says so, blocks Save, keeps the typed text until the current values are taken', async () => {
    patchReply = { status: 409, body: { error: 'Someone else changed these details while you were editing. Nothing was saved; the current values are shown.', values: { ...VALUES, genre: 'Pop' }, updatedAt: '2026-10-19T09:00:00.000Z' } };
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    await screen.findByLabelText('ISRC');
    type('Genre', 'Rock');
    fireEvent.click(screen.getByTestId('org-metadata-save'));
    const box = await screen.findByTestId('org-metadata-conflict');
    expect(box.textContent).toMatch(/Someone else changed/);
    expect((screen.getByLabelText('Genre') as HTMLInputElement).value).toBe('Rock');
    expect((screen.getByTestId('org-metadata-save') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('org-metadata-reload'));
    await waitFor(() => expect((screen.getByLabelText('Genre') as HTMLInputElement).value).toBe('Pop'));
    expect(screen.queryByTestId('org-metadata-conflict')).toBeNull();
  });

  it('says why when the details cannot be loaded', async () => {
    load = { status: 404, body: { error: 'Not found' } };
    render(<OrgTrackMetadata orgId="o1" trackId="t1" />);
    expect((await screen.findByTestId('org-metadata-error')).textContent).toBe('Not found');
  });
});
