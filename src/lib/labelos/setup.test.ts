import { describe, expect, it } from 'vitest';
import {
  BUYER_HOME,
  cleanOrgName,
  faceFromMetadata,
  interpretSetupResult,
  isSetupFace,
  kindForFace,
  nonMemberLanding,
  setupHref,
} from './setup';

const ORG = '22222222-2222-4222-8222-222222222222';

describe('faces', () => {
  it('are exactly independent and label, never the producer kind', () => {
    expect(isSetupFace('independent')).toBe(true);
    expect(isSetupFace('label')).toBe(true);
    for (const v of ['producer', 'artist', 'studio', '', null, undefined, 1, 'LABEL']) expect(isSetupFace(v), String(v)).toBe(false);
  });

  it('map onto the org kinds artist and label', () => {
    expect(kindForFace('independent')).toBe('artist');
    expect(kindForFace('label')).toBe('label');
  });
});

describe('cleanOrgName', () => {
  it('collapses whitespace and trims', () => {
    expect(cleanOrgName('  Northside   Records \n')).toBe('Northside Records');
  });
  it('refuses blank, too long, non-strings and control characters', () => {
    expect(cleanOrgName('   ')).toBeNull();
    expect(cleanOrgName('x'.repeat(81))).toBeNull();
    expect(cleanOrgName('x'.repeat(80))).toBe('x'.repeat(80));
    expect(cleanOrgName(42)).toBeNull();
    expect(cleanOrgName('a\u0000b')).toBeNull();
  });
});

describe('faceFromMetadata', () => {
  it('reads account_type when it is a face', () => {
    expect(faceFromMetadata({ account_type: 'label' })).toBe('label');
    expect(faceFromMetadata({ account_type: 'independent' })).toBe('independent');
  });
  it('ignores anything else', () => {
    for (const m of [null, undefined, 'label', {}, { account_type: 'producer' }, { account_type: ['label'] }]) {
      expect(faceFromMetadata(m)).toBeNull();
    }
  });
});

describe('nonMemberLanding', () => {
  it('flag off: the buyer account, whatever was picked', () => {
    expect(nonMemberLanding({ labelOsEnabled: false, metadata: { account_type: 'label' } })).toBe(BUYER_HOME);
  });
  it('flag on: /setup, with the face when one was picked', () => {
    expect(nonMemberLanding({ labelOsEnabled: true, metadata: { account_type: 'label' } })).toBe('/setup?type=label');
    expect(nonMemberLanding({ labelOsEnabled: true, metadata: null })).toBe('/setup');
    expect(setupHref('independent')).toBe('/setup?type=independent');
  });
});

describe('interpretSetupResult', () => {
  it('created and exists', () => {
    expect(interpretSetupResult({ org_id: ORG, slug: 'nova', kind: 'artist', created: true }, null)).toEqual({
      status: 'created', orgId: ORG, slug: 'nova', kind: 'artist',
    });
    expect(interpretSetupResult({ org_id: ORG, slug: 'nova', kind: 'label', created: false }, null).status).toBe('exists');
  });
  it('missing schema degrades', () => {
    for (const code of ['PGRST202', '42883']) expect(interpretSetupResult(null, { code, message: 'x' }).status).toBe('schema_missing');
    expect(interpretSetupResult(null, { message: 'function labelos_setup_org does not exist' }).status).toBe('schema_missing');
  });
  it('anything else is a failure, never a made-up org', () => {
    expect(interpretSetupResult(null, { code: '22023', message: 'kind must be artist or label' })).toEqual({
      status: 'failed', error: 'kind must be artist or label',
    });
    for (const d of [null, [], { org_id: 'nope', slug: 'a', kind: 'artist', created: true }, { org_id: ORG, slug: '', kind: 'artist', created: true }, { org_id: ORG, slug: 'a', kind: 'producer', created: true }]) {
      expect(interpretSetupResult(d, null).status).toBe('failed');
    }
  });
});
