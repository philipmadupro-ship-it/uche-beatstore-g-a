// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import { classifyPlayRejection, holdsSource } from './play-rejection';

const domErr = (name: string) => Object.assign(new Error(name), { name });

describe('classifyPlayRejection', () => {
  it('ignores a play() superseded by a new load or pause', () => {
    // The case that put "Tap play to start this preview." on a preview the
    // buyer had just tapped.
    expect(classifyPlayRejection(domErr('AbortError'))).toBe('ignore');
  });

  it('asks for a tap only when autoplay is really blocked', () => {
    expect(classifyPlayRejection(domErr('NotAllowedError'))).toBe('needs-gesture');
  });

  it('treats anything else as a failed source', () => {
    expect(classifyPlayRejection(domErr('NotSupportedError'))).toBe('failed');
    expect(classifyPlayRejection(undefined)).toBe('failed');
    expect(classifyPlayRejection('boom')).toBe('failed');
  });
});

describe('holdsSource', () => {
  it('matches a relative source the element was given', () => {
    const el = document.createElement('audio');
    el.src = '/api/store/preview/t1';
    // `el.src` is now absolute — the old comparison said "different" here.
    expect(el.src).not.toBe('/api/store/preview/t1');
    expect(holdsSource(el, '/api/store/preview/t1')).toBe(true);
  });

  it('reports a different source', () => {
    const el = document.createElement('audio');
    el.src = '/api/store/preview/t1';
    expect(holdsSource(el, 'blob:http://x/abc')).toBe(false);
  });

  it('reports an empty element as not holding anything', () => {
    expect(holdsSource(document.createElement('audio'), '/a.wav')).toBe(false);
  });
});
