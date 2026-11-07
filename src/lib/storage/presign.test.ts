import { describe, expect, it } from 'vitest';
import { UploadPartCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { r2 } from './upload';

// A browser PUTs a body the signer never saw, so a presigned URL must not
// carry a checksum computed over an empty one (R2 would reject the part).
describe('presigned upload URLs', () => {
  const sign = (which: 'UploadPart' | 'PutObject') =>
    which === 'UploadPart'
      ? getSignedUrl(r2, new UploadPartCommand({ Bucket: 'b', Key: 'k', UploadId: 'u', PartNumber: 1 }), { expiresIn: 900 })
      : getSignedUrl(r2, new PutObjectCommand({ Bucket: 'b', Key: 'k', ContentType: 'audio/wav' }), { expiresIn: 900 });

  it.each(['UploadPart', 'PutObject'] as const)('%s carries no checksum params', async (which) => {
    const url = new URL(await sign(which));
    const names = [...url.searchParams.keys()].map((k) => k.toLowerCase());
    expect(names.filter((k) => k.includes('checksum'))).toEqual([]);
    expect(url.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });
});
