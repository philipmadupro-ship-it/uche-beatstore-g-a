import { describe, expect, it } from 'vitest';
import { diffDraft, toDraft } from './track-metadata-client';
import { METADATA_FIELDS, type MetadataValues } from './track-metadata';

const SAVED: MetadataValues = {
  title: 'Midnight', version_label: null, isrc: 'GBAAA2600001', iswc: null, bpm: 140, key: 'F minor', language: null,
  explicit: false, genre: null, recorded_on: null, p_line: null, master_owner: null, notes: null,
};

describe('diffDraft', () => {
  it('an untouched form sends nothing', () => {
    expect(diffDraft(SAVED, toDraft(SAVED), METADATA_FIELDS)).toEqual({});
  });

  it('sends only what changed; blank clears; explicit has three states', () => {
    const draft = { ...toDraft(SAVED), isrc: '', genre: ' Pop ', bpm: '', explicit: 'unset' };
    expect(diffDraft(SAVED, draft, METADATA_FIELDS)).toEqual({ isrc: null, genre: 'Pop', bpm: null, explicit: null });
  });

  it('only looks at the fields the form shows', () => {
    const draft = { ...toDraft(SAVED), iswc: 'T-034.524.680-1' };
    expect(diffDraft(SAVED, draft, METADATA_FIELDS.filter((f) => f !== 'iswc'))).toEqual({});
  });

  it('passes a non-number bpm through for the server to refuse', () => {
    expect(diffDraft(SAVED, { ...toDraft(SAVED), bpm: 'fast' }, METADATA_FIELDS)).toEqual({ bpm: 'fast' });
  });
});
