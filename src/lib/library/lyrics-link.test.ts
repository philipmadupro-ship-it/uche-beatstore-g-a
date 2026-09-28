// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LYRICS_ANCHOR, focusLyricsSection, isLyricsHash, lyricsStudioHref } from './lyrics-link';

afterEach(() => { document.body.innerHTML = ''; });

describe('lyricsStudioHref', () => {
  it('points at the track page lyrics section', () => {
    expect(lyricsStudioHref('abc-123')).toBe('/library/abc-123#lyrics');
  });

  it('encodes the id so it cannot escape the path segment', () => {
    expect(lyricsStudioHref('a/b#c')).toBe('/library/a%2Fb%23c#lyrics');
  });
});

describe('isLyricsHash', () => {
  it('accepts the anchor with or without the leading #', () => {
    expect(isLyricsHash('#lyrics')).toBe(true);
    expect(isLyricsHash('lyrics')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isLyricsHash('')).toBe(false);
    expect(isLyricsHash(null)).toBe(false);
    expect(isLyricsHash('#lyrics-extra')).toBe(false);
    expect(isLyricsHash('#stems')).toBe(false);
  });
});

describe('focusLyricsSection', () => {
  function mountSection() {
    const el = document.createElement('section');
    el.id = LYRICS_ANCHOR;
    el.tabIndex = -1;
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
    return el;
  }

  it('focuses and scrolls to the section when the hash asks for it', () => {
    const el = mountSection();
    expect(focusLyricsSection(document, '#lyrics')).toBe(true);
    expect(document.activeElement).toBe(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });

  it('does nothing without the hash', () => {
    const el = mountSection();
    expect(focusLyricsSection(document, '')).toBe(false);
    expect(document.activeElement).not.toBe(el);
    expect(el.scrollIntoView).not.toHaveBeenCalled();
  });

  // The regression: the page renders a spinner first, so the section is not
  // there yet when the hash is first seen. Reporting false lets the page try
  // again once the track (and the section) has mounted.
  it('reports false while the section has not mounted yet', () => {
    expect(focusLyricsSection(document, '#lyrics')).toBe(false);
  });
});
