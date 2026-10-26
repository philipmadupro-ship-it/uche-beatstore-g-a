/**
 * R-05 (LABEL-14): an org recording's preview and peaks land in the PRIVATE
 * bucket under orgs/<org>/, and the producer's public-derivative helpers
 * refuse an org master whatever route, cron or button calls them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const puts: Array<{ Bucket: string; Key: string; CacheControl?: string; ContentType?: string }> = [];
let r2Configured = true;

vi.mock('@aws-sdk/client-s3', () => {
  class Cmd { constructor(public input: Record<string, unknown>) {} }
  class PutObjectCommand extends Cmd {}
  return {
    S3Client: class { async send(cmd: Cmd) { if (cmd instanceof PutObjectCommand) puts.push(cmd.input as never); return {}; } },
    PutObjectCommand,
    GetObjectCommand: Cmd,
    DeleteObjectCommand: Cmd,
  };
});
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: async () => 'https://signed' }));
vi.mock('@/lib/local-store', () => ({ isR2Configured: () => r2Configured }));
vi.mock('@/lib/audio/preview-clip', () => ({
  buildPreviewClip: async () => ({ buffer: Buffer.from('clip'), ext: 'mp3', contentType: 'audio/mpeg' }),
}));

import { uploadOrgPeaks, uploadOrgPreview } from './org-media';
import { uploadPeaksSidecar, uploadBandsSidecar, uploadPreviewAsset, uploadPublicPreview } from './upload';

const ORG = 'b1410000-0000-4000-8000-000000000001';
const ORG_MASTER = `r2://masters/orgs/${ORG}/tracks/abc.wav`;

beforeEach(() => {
  puts.length = 0;
  r2Configured = true;
  vi.stubEnv('R2_PRIVATE_BUCKET_NAME', 'masters');
  vi.stubEnv('R2_BUCKET_NAME', 'public-bucket');
  vi.stubEnv('NEXT_PUBLIC_R2_PUBLIC_URL', 'https://pub.example');
});
afterEach(() => vi.unstubAllEnvs());

describe('org previews and peaks go to the private bucket', () => {
  it('a preview clip is stored under orgs/<org>/previews/ in the private bucket, never cached publicly', async () => {
    const ref = await uploadOrgPreview(ORG, Buffer.from('master'), ORG_MASTER, 200);
    expect(ref).toMatch(new RegExp(`^r2://masters/orgs/${ORG}/previews/[A-Za-z0-9_-]+\\.mp3$`));
    expect(puts).toHaveLength(1);
    expect(puts[0].Bucket).toBe('masters');
    expect(puts[0].Key.startsWith(`orgs/${ORG}/previews/`)).toBe(true);
    expect(puts[0].CacheControl).toBe('private, no-store');
    expect(puts.some((p) => p.Bucket === 'public-bucket')).toBe(false);
  });

  it('peaks are stored under orgs/<org>/peaks/ in the private bucket', async () => {
    const ref = await uploadOrgPeaks(ORG, '[0,1]');
    expect(ref).toMatch(new RegExp(`^r2://masters/orgs/${ORG}/peaks/[A-Za-z0-9_-]+\\.json$`));
    expect(puts.map((p) => p.Bucket)).toEqual(['masters']);
  });

  it('without R2 there is no private bucket: no preview, no peaks, nothing written publicly', async () => {
    r2Configured = false;
    expect(await uploadOrgPreview(ORG, Buffer.from('master'), '/uploads/x.wav', 200)).toBeNull();
    expect(await uploadOrgPeaks(ORG, '[0]')).toBeNull();
    expect(puts).toEqual([]);
  });

  it('refuses to report a reference outside the private bucket (a misconfigured bucket name)', async () => {
    vi.stubEnv('R2_PRIVATE_BUCKET_NAME', '');
    await expect(uploadOrgPreview(ORG, Buffer.from('master'), ORG_MASTER, 200)).rejects.toThrow();
    expect(await uploadOrgPeaks(ORG, '[0]')).toBeNull();
  });
});

describe('the producer pipeline never derives a public file from an org master', () => {
  it('uploadPublicPreview refuses', async () => {
    await expect(uploadPublicPreview(Buffer.from('master'), ORG_MASTER, 200)).rejects.toThrow(/never gets a public preview/);
    expect(puts).toEqual([]);
  });

  it('uploadPreviewAsset (backfill, analyze) refuses', async () => {
    await expect(uploadPreviewAsset(ORG_MASTER, Buffer.from('clip'), 'mp3', 'audio/mpeg')).rejects.toThrow(/never gets a public preview/);
    expect(puts).toEqual([]);
  });

  it('peaks and bands sidecars are not written', async () => {
    expect(await uploadPeaksSidecar(ORG_MASTER, '[0]')).toBeNull();
    expect(await uploadBandsSidecar(ORG_MASTER, '[0]')).toBeNull();
    expect(puts).toEqual([]);
  });

  it('a producer master still gets its public preview and sidecar, as before', async () => {
    const producerMaster = 'r2://masters/tracks/abc.wav';
    expect(await uploadPublicPreview(Buffer.from('master'), producerMaster, 200)).toMatch(/^https:\/\/pub\.example\/previews\//);
    expect(await uploadPeaksSidecar(producerMaster, '[0]')).toBe('https://pub.example/peaks/tracks-abc.wav.peaks.json');
    expect(puts.map((p) => p.Bucket)).toEqual(['public-bucket', 'public-bucket']);
  });
});
