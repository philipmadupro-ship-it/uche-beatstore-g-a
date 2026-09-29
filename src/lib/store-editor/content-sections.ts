/**
 * The producer-authored section kinds — `text`, `image`, `video`, `links`,
 * `canvas` — as the LIVE storefront renders them.
 *
 * These carry their own content rather than drawing storefront data, and both
 * surfaces draw them through the one `SectionRenderer`. What differs is what an
 * EMPTY one should look like: the builder says "add an image URL in the
 * inspector", which is the right thing to show a producer and a broken-looking
 * thing to show a buyer. `hasLiveContent` is that rule, in one place.
 *
 * The URL guards here are the storefront's enforced CSP expressed as data
 * (`img-src 'self' data: blob: https:`), applied in the builder as well so the
 * preview can never show an image the live page would block.
 */
import type { CreatorProfile } from '@/components/store/types';
import { storeSocialLinks } from '@/lib/store/social-links';
import {
  resolveSection, storeBreakpoints,
  type StoreBreakpoint, type StoreSection, type StoreSectionKind,
} from './layout';
import { videoEmbedUrl } from './video-embed';

export const contentSectionKinds = ['text', 'image', 'video', 'links', 'canvas'] as const satisfies readonly StoreSectionKind[];

export function isContentSection(kind: StoreSectionKind): boolean {
  return (contentSectionKinds as readonly StoreSectionKind[]).includes(kind);
}

/**
 * An image `src` the storefront can load, or null.
 *
 * `http:` is upgraded rather than dropped — it is almost always the same file
 * behind https, and the page is https, so the plain URL would be mixed content
 * and blocked anyway. Protocol-relative (`//host`) and every other scheme are
 * refused.
 */
export function safeImageSrc(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https:\/\/[^/\s]/i.test(value)) return value;
  if (/^http:\/\/[^/\s]/i.test(value)) return `https://${value.slice('http://'.length)}`;
  return null;
}

/**
 * A text section's button target, or null to draw it as a plain label.
 * Site-relative paths, http(s) and mailto only — never `javascript:`.
 */
export function safeLinkHref(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https?:\/\/[^/\s]/i.test(value)) return value;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) return value;
  return null;
}

/**
 * Whether a content section has anything to show a buyer. Kinds that are not
 * content sections always return true — this rule is about empty placeholders,
 * not about the storefront's own sections.
 */
export function hasLiveContent(section: StoreSection, creator: CreatorProfile | null): boolean {
  const content = section.content ?? {};
  switch (section.kind) {
    case 'text':
      return Boolean(content.heading?.trim() || content.body?.trim() || content.ctaLabel?.trim());
    case 'image':
      return safeImageSrc(content.imageUrl) !== null;
    case 'video':
      return videoEmbedUrl(content.videoUrl) !== null;
    case 'links':
      return storeSocialLinks(creator).length > 0;
    case 'canvas':
      return (content.blocks ?? []).some((block) =>
        block.kind === 'shape'
        || (block.kind === 'text' && Boolean(block.text?.trim()))
        || (block.kind === 'image' && safeImageSrc(block.imageUrl) !== null));
    default:
      return true;
  }
}

/**
 * The breakpoint to resolve a section's settings at on the live page.
 *
 * `SectionRenderer` returns nothing for a breakpoint the section is hidden on.
 * The storefront hides sections with CSS instead (`visibilityClasses`), because
 * it is one cached tree for every device — and the viewer's breakpoint reads
 * `desktop` until after hydration. Asking the renderer for a breakpoint the
 * section is hidden on would therefore drop, from the HTML every device gets,
 * a section that is only hidden on desktop. So: the viewer's breakpoint when
 * the section shows there, otherwise the first one it does show on. Where it
 * is hidden, the CSS wrapper already hides it, so which settings it was drawn
 * with cannot be seen.
 */
export function renderBreakpointFor(section: StoreSection, preferred: StoreBreakpoint): StoreBreakpoint | null {
  if (resolveSection(section, preferred).visible) return preferred;
  return storeBreakpoints.find((point) => resolveSection(section, point).visible) ?? null;
}
