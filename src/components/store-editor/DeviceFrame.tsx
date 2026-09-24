'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Renders its children inside an iframe of a real device width.
 *
 * Why an iframe: the storefront components are responsive through Tailwind
 * breakpoints (`md:`, `lg:`), and a media query answers to the VIEWPORT. On
 * the old canvas the viewport was the producer's laptop, so "mobile" rendered
 * the desktop hero type and desktop grids squeezed into a 390px box — which is
 * exactly what the producer said did not look like mobile. Inside an iframe
 * the viewport IS the frame, so every breakpoint resolves as on the device.
 *
 * The children are still this React tree (a portal into the frame's body), so
 * state, context and handlers are shared with the builder; React attaches its
 * event listeners to a portal container in another document. The parent's
 * stylesheets are cloned in — and kept in sync, since dev HMR swaps them — so
 * the frame looks exactly like the app. Height follows the content, so the
 * builder's own stage does the scrolling, as before.
 */
interface Props {
  width: number;
  title: string;
  children: ReactNode;
  /** Gets the frame's window once mounted — e.g. to listen for shortcuts. */
  onWindow?: (win: Window | null) => void;
}

function syncStyles(target: Document) {
  // Remove previous clones, then copy every stylesheet/style from the parent.
  target.head.querySelectorAll('[data-frame-style]').forEach((n) => n.remove());
  document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-frame-style', '');
    target.head.appendChild(clone);
  });
}

export function DeviceFrame({ width, title, children, onWindow }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [height, setHeight] = useState(600);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let observer: ResizeObserver | null = null;
    let headObserver: MutationObserver | null = null;

    const init = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      doc.documentElement.className = document.documentElement.className;
      const theme = document.documentElement.getAttribute('data-theme');
      if (theme) doc.documentElement.setAttribute('data-theme', theme);
      syncStyles(doc);
      doc.body.style.margin = '0';
      doc.body.style.background = '#090907';
      doc.body.className = document.body.className;
      let root = doc.getElementById('frame-root');
      if (!root) {
        root = doc.createElement('div');
        root.id = 'frame-root';
        doc.body.appendChild(root);
      }
      observer = new ResizeObserver(() => setHeight(Math.max(200, root!.scrollHeight)));
      observer.observe(root);
      headObserver = new MutationObserver(() => syncStyles(doc));
      headObserver.observe(document.head, { childList: true });
      setMount(root);
      onWindow?.(iframe.contentWindow);
    };

    // about:blank is usually ready synchronously; load covers the rest.
    if (iframe.contentDocument?.readyState === 'complete') init();
    else iframe.addEventListener('load', init, { once: true });

    return () => {
      observer?.disconnect();
      headObserver?.disconnect();
      iframe.removeEventListener('load', init);
      onWindow?.(null);
    };
    // onWindow is a callback prop; re-running on its identity would tear the frame down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <iframe
        ref={iframeRef}
        title={title}
        style={{ width, height, border: 0, display: 'block', background: '#090907' }}
      />
      {mount ? createPortal(children, mount) : null}
    </>
  );
}
