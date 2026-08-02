/**
 * Cover-art image generation — the pure half.
 *
 * Prompt construction and provider response parsing live here, with no network
 * and no secrets, so they can be unit-tested. The route in
 * `app/api/cover/generate` does the fetching and the R2 upload.
 *
 * KEY HANDLING. Keys are read from server environment variables and never
 * accepted from the browser. A key posted from the client would appear in the
 * network panel, in any proxy or error log along the way, and in this app's own
 * request logging — and would sit in localStorage where any XSS could read it.
 * Provider keys are billing credentials; there is no version of client-side
 * key entry that is safe, so the UI reports which providers are configured
 * rather than asking for a key.
 */

export type CoverProvider = 'openai' | 'gemini';

/** Square sizes both providers accept. Cover art is square by convention. */
export const COVER_SIZES = [1024] as const;

export interface CoverPromptOptions {
  /** What the producer typed. The subject of the image. */
  prompt: string;
  /** Named look, from the studio's art directions. */
  style?: string;
  /** Hex colours the image should be built around. */
  palette?: string[];
  /** Extra guidance, e.g. "no faces". */
  avoid?: string;
  /** Track mood/genre tags, folded in as atmosphere. */
  tags?: string[];
}

/** Hex colour, 3 or 6 digits. Anything else is dropped from the prompt. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: string): boolean {
  return HEX.test(value.trim());
}

/**
 * Build the text prompt sent to the provider.
 *
 * Two things are always appended regardless of what the producer typed:
 *
 *   - "no text/lettering". The studio composes title and metadata as real text
 *     LAYERS on top of the image. Generated lettering is famously malformed,
 *     and here it would also collide with the real title — so it is excluded at
 *     the prompt level rather than cropped out afterwards.
 *   - "album cover, square". Keeps composition centred and away from the edges,
 *     which matters because the studio masks and crops this image.
 */
export function buildCoverPrompt(options: CoverPromptOptions): string {
  const parts: string[] = [];

  const subject = options.prompt.trim();
  if (subject) parts.push(subject);

  if (options.style?.trim()) parts.push(`Art direction: ${options.style.trim()}.`);

  const colors = (options.palette ?? []).filter(isHexColor);
  if (colors.length > 0) {
    parts.push(`Built around this exact colour palette: ${colors.join(', ')}.`);
  }

  const tags = (options.tags ?? []).map((t) => t.trim()).filter(Boolean);
  if (tags.length > 0) parts.push(`Mood: ${tags.join(', ')}.`);

  parts.push('Square album cover artwork, striking composition, centred subject with clear margins.');
  parts.push('No text, no lettering, no watermarks, no logos.');

  if (options.avoid?.trim()) parts.push(`Avoid: ${options.avoid.trim()}.`);

  return parts.join(' ');
}

/* ── Provider availability ─────────────────────────────────────────────── */

export interface ProviderAvailability {
  openai: boolean;
  gemini: boolean;
}

export function availableProviders(env: Record<string, string | undefined>): ProviderAvailability {
  return {
    openai: Boolean(env.OPENAI_API_KEY?.trim()),
    gemini: Boolean((env.GEMINI_API_KEY ?? env.GOOGLE_AI_API_KEY)?.trim()),
  };
}

/**
 * Pick the provider to use.
 *
 * An explicit request for an unconfigured provider is an error rather than a
 * silent fallback — quietly billing a different provider than the one asked
 * for, and returning a different house style, would be worse than failing.
 */
export function resolveProvider(
  requested: CoverProvider | undefined,
  available: ProviderAvailability,
): { ok: true; provider: CoverProvider } | { ok: false; error: string } {
  if (requested) {
    if (available[requested]) return { ok: true, provider: requested };
    return {
      ok: false,
      error: `${requested === 'openai' ? 'OpenAI' : 'Gemini'} is not configured. `
        + `Set ${requested === 'openai' ? 'OPENAI_API_KEY' : 'GEMINI_API_KEY'} in the server environment.`,
    };
  }
  if (available.openai) return { ok: true, provider: 'openai' };
  if (available.gemini) return { ok: true, provider: 'gemini' };
  return {
    ok: false,
    error: 'No image provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY in the server environment.',
  };
}

/* ── Response parsing ──────────────────────────────────────────────────── */

/**
 * Pull base64 image bytes out of an OpenAI images response.
 *
 * `gpt-image-1` returns `b64_json`; older deployments may return a `url`
 * instead, which this reports as unsupported rather than silently returning
 * nothing — a URL would need a second fetch and a different code path.
 */
export function parseOpenAIImage(body: unknown): { ok: true; b64: string } | { ok: false; error: string } {
  const data = (body as { data?: Array<{ b64_json?: string; url?: string }> } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    const err = (body as { error?: { message?: string } } | null)?.error?.message;
    return { ok: false, error: err || 'OpenAI returned no image data.' };
  }
  const first = data[0];
  if (typeof first?.b64_json === 'string' && first.b64_json.length > 0) {
    return { ok: true, b64: first.b64_json };
  }
  if (typeof first?.url === 'string') {
    return { ok: false, error: 'OpenAI returned a URL rather than image bytes; expected b64_json.' };
  }
  return { ok: false, error: 'OpenAI response contained no usable image.' };
}

/** Pull base64 image bytes out of a Gemini/Imagen predict response. */
export function parseGeminiImage(body: unknown): { ok: true; b64: string } | { ok: false; error: string } {
  const b = body as {
    predictions?: Array<{ bytesBase64Encoded?: string }>;
    error?: { message?: string };
  } | null;

  if (b?.error?.message) return { ok: false, error: b.error.message };

  const first = b?.predictions?.[0]?.bytesBase64Encoded;
  if (typeof first === 'string' && first.length > 0) return { ok: true, b64: first };

  return { ok: false, error: 'Gemini returned no image data.' };
}

/** Guard against a prompt that is empty or absurdly long before spending money. */
export const MAX_PROMPT_LENGTH = 4000;

export function validatePrompt(prompt: unknown): { ok: true; prompt: string } | { ok: false; error: string } {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { ok: false, error: 'A prompt is required.' };
  }
  const trimmed = prompt.trim();
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    return { ok: false, error: `Prompt is too long (${trimmed.length} chars, max ${MAX_PROMPT_LENGTH}).` };
  }
  return { ok: true, prompt: trimmed };
}
