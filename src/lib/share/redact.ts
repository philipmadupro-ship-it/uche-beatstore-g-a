/**
 * What may appear in a share image.
 *
 * A share image leaves the app — it is downloaded, posted, cached by CDNs — so
 * nothing private may be inside it. A track row can carry an opaque `r2://`
 * reference (never publicly fetchable) or a presigned URL (a bearer credential
 * that expires). Both are dropped here; the image then simply has no cover.
 */

const SIGNED_PARAMS = /(^|[?&])(x-amz-[a-z-]+|signature|sig|token|expires|awsaccesskeyid|x-goog-[a-z-]+)=/i;

/**
 * https URL or site-relative path, else null.
 *
 * `http:` is upgraded (the storefront CSP only admits https), `//host` is
 * refused (protocol-relative is how a relative check gets bypassed), and
 * anything that looks presigned is refused whatever its scheme.
 */
export function publicImageUrl(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || /[\u0000-\u001f\s]/.test(value)) return null;
  if (SIGNED_PARAMS.test(value)) return null;
  if (value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) return value;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:') url.protocol = 'https:';
    if (url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
