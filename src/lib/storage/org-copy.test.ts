import { describe, expect, it } from 'vitest';
import { copyableSource } from './org-copy';

const ART = '10000000-0000-4000-8000-000000000002';
const OTHER = '10000000-0000-4000-8000-000000000003';
const org = { kind: 'org', orgId: ART } as const;
const producer = { kind: 'producer' } as const;

describe('copyableSource: only the owner’s own files in the private bucket', () => {
  it('an org recording: only under orgs/<that org>/', () => {
    expect(copyableSource(`r2://priv/orgs/${ART}/tracks/a.mp3`, 'priv', true, org)).toBe(true);
    expect(copyableSource(`r2://priv/orgs/${OTHER}/tracks/a.mp3`, 'priv', true, org)).toBe(false); // another org's object
    expect(copyableSource('r2://priv/tracks/a.mp3', 'priv', true, org)).toBe(false); // a producer object
    expect(copyableSource(`r2://priv/orgs/${ART}/../${OTHER}/tracks/a.mp3`, 'priv', true, org)).toBe(false);
    expect(copyableSource(`r2://pub/orgs/${ART}/tracks/a.mp3`, 'priv', true, org)).toBe(false); // not the private bucket
    expect(copyableSource(`r2://priv/orgs/${ART}/tracks/a.mp3`, null, true, org)).toBe(false);
  });

  it('a producer recording: the producer area, never an org’s', () => {
    expect(copyableSource('r2://priv/tracks/a.mp3', 'priv', true, producer)).toBe(true);
    expect(copyableSource(`r2://priv/orgs/${ART}/tracks/a.mp3`, 'priv', true, producer)).toBe(false);
    expect(copyableSource('r2://priv/covers/a.png', 'priv', true, producer)).toBe(false);
  });

  it('without R2 (local files) the same ownership holds, and r2 references are refused', () => {
    expect(copyableSource(`/uploads/orgs/${ART}/tracks/a.wav`, null, false, org)).toBe(true);
    expect(copyableSource(`/uploads/orgs/${OTHER}/tracks/a.wav`, null, false, org)).toBe(false);
    expect(copyableSource('/uploads/a.wav', null, false, org)).toBe(false);
    expect(copyableSource('/uploads/a.wav', null, false, producer)).toBe(true);
    expect(copyableSource(`/uploads/orgs/${ART}/tracks/a.wav`, null, false, producer)).toBe(false);
    expect(copyableSource('/uploads/../etc/passwd', null, false, producer)).toBe(false);
    expect(copyableSource('r2://priv/tracks/a.mp3', null, false, producer)).toBe(false);
    expect(copyableSource('https://cdn.example/a.mp3', null, false, producer)).toBe(false);
    expect(copyableSource('', null, false, producer)).toBe(false);
  });
});
