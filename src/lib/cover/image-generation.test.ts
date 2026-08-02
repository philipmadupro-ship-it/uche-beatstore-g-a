import { describe, it, expect } from 'vitest';
import {
  buildCoverPrompt,
  availableProviders,
  resolveProvider,
  parseOpenAIImage,
  parseGeminiImage,
  validatePrompt,
  isHexColor,
  MAX_PROMPT_LENGTH,
} from './image-generation';

describe('buildCoverPrompt', () => {
  it('always excludes text, because the studio composes titles as real layers', () => {
    // Generated lettering is malformed and would collide with the actual title
    // layer drawn on top, so it is excluded at the prompt rather than cropped.
    const p = buildCoverPrompt({ prompt: 'a lone figure on a salt flat' });
    expect(p.toLowerCase()).toContain('no text');
    expect(p).toContain('a lone figure on a salt flat');
  });

  it('asks for a square, centred composition', () => {
    const p = buildCoverPrompt({ prompt: 'x' });
    expect(p.toLowerCase()).toContain('square');
  });

  it('includes valid hex colours verbatim', () => {
    const p = buildCoverPrompt({ prompt: 'x', palette: ['#0D0D0A', '#C7B89D'] });
    expect(p).toContain('#0D0D0A');
    expect(p).toContain('#C7B89D');
  });

  it('drops values that are not hex colours', () => {
    // A stray label in the palette array must not become prompt text.
    const p = buildCoverPrompt({ prompt: 'x', palette: ['#fff', 'rgb(1,2,3)', 'DROP TABLE', ''] });
    expect(p).toContain('#fff');
    expect(p).not.toContain('DROP TABLE');
    expect(p).not.toContain('rgb(');
  });

  it('folds in style, tags and avoid guidance', () => {
    const p = buildCoverPrompt({
      prompt: 'basalt monolith', style: 'Brutalist Archive', tags: ['dark', 'eerie'], avoid: 'faces',
    });
    expect(p).toContain('Brutalist Archive');
    expect(p).toContain('dark, eerie');
    expect(p).toContain('faces');
  });

  it('produces a usable prompt even with only a subject', () => {
    const p = buildCoverPrompt({ prompt: 'smoke' });
    expect(p.length).toBeGreaterThan('smoke'.length);
  });
});

describe('isHexColor', () => {
  it('accepts 3 and 6 digit hex', () => {
    expect(isHexColor('#fff')).toBe(true);
    expect(isHexColor('#C7B89D')).toBe(true);
  });
  it('rejects everything else', () => {
    for (const v of ['fff', '#gg0000', 'red', '', '#12345', 'rgb(0,0,0)']) {
      expect(isHexColor(v)).toBe(false);
    }
  });
});

describe('availableProviders', () => {
  it('detects each provider from its env var', () => {
    expect(availableProviders({ OPENAI_API_KEY: 'sk-x' })).toEqual({ openai: true, gemini: false });
    expect(availableProviders({ GEMINI_API_KEY: 'g' })).toEqual({ openai: false, gemini: true });
  });

  it('accepts GOOGLE_AI_API_KEY as an alias for Gemini', () => {
    expect(availableProviders({ GOOGLE_AI_API_KEY: 'g' }).gemini).toBe(true);
  });

  it('treats blank and whitespace-only keys as unset', () => {
    expect(availableProviders({ OPENAI_API_KEY: '   ' }).openai).toBe(false);
    expect(availableProviders({}).openai).toBe(false);
  });
});

describe('resolveProvider', () => {
  it('uses the requested provider when configured', () => {
    const r = resolveProvider('gemini', { openai: true, gemini: true });
    expect(r).toEqual({ ok: true, provider: 'gemini' });
  });

  it('errors rather than silently falling back to the other provider', () => {
    // Billing a provider the user did not choose — and returning a different
    // house style — is worse than failing loudly.
    const r = resolveProvider('gemini', { openai: true, gemini: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('GEMINI_API_KEY');
  });

  it('picks whichever is configured when none is requested', () => {
    expect(resolveProvider(undefined, { openai: false, gemini: true }))
      .toEqual({ ok: true, provider: 'gemini' });
  });

  it('explains what to set when nothing is configured', () => {
    const r = resolveProvider(undefined, { openai: false, gemini: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('OPENAI_API_KEY');
      expect(r.error).toContain('GEMINI_API_KEY');
    }
  });
});

describe('parseOpenAIImage', () => {
  it('extracts b64_json', () => {
    expect(parseOpenAIImage({ data: [{ b64_json: 'AAA' }] })).toEqual({ ok: true, b64: 'AAA' });
  });

  it('surfaces the provider error message', () => {
    const r = parseOpenAIImage({ error: { message: 'billing hard limit reached' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('billing hard limit reached');
  });

  it('reports a URL-only response as unsupported instead of returning nothing', () => {
    const r = parseOpenAIImage({ data: [{ url: 'https://x/y.png' }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('URL');
  });

  it('never throws on malformed bodies', () => {
    for (const b of [null, undefined, {}, [], 'str', { data: [] }, { data: [{}] }]) {
      expect(() => parseOpenAIImage(b)).not.toThrow();
      expect(parseOpenAIImage(b).ok).toBe(false);
    }
  });
});

describe('parseGeminiImage', () => {
  it('extracts bytesBase64Encoded', () => {
    expect(parseGeminiImage({ predictions: [{ bytesBase64Encoded: 'BBB' }] }))
      .toEqual({ ok: true, b64: 'BBB' });
  });

  it('surfaces the provider error message', () => {
    const r = parseGeminiImage({ error: { message: 'API key not valid' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('API key not valid');
  });

  it('never throws on malformed bodies', () => {
    for (const b of [null, undefined, {}, [], 'str', { predictions: [] }]) {
      expect(() => parseGeminiImage(b)).not.toThrow();
      expect(parseGeminiImage(b).ok).toBe(false);
    }
  });
});

describe('validatePrompt', () => {
  it('requires a non-empty prompt', () => {
    for (const v of ['', '   ', null, undefined, 5, {}]) {
      expect(validatePrompt(v).ok).toBe(false);
    }
  });

  it('trims and accepts a real prompt', () => {
    expect(validatePrompt('  smoke  ')).toEqual({ ok: true, prompt: 'smoke' });
  });

  it('rejects an over-long prompt before any spend', () => {
    const r = validatePrompt('x'.repeat(MAX_PROMPT_LENGTH + 1));
    expect(r.ok).toBe(false);
  });
});
