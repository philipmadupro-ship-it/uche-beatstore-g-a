import { createSection, type SectionContent, type SectionSettings, type StoreSection, type StoreSectionKind } from './layout';

/**
 * Starting points for a new section — a kind plus the style and copy that make
 * it look finished on insert, instead of a blank block the producer has to
 * dress from zero. They are ordinary sections afterwards: every value here is
 * editable in the inspector, nothing is locked to the preset.
 */
export interface SectionPreset {
  id: string;
  label: string;
  hint: string;
  kind: StoreSectionKind;
  base?: Partial<SectionSettings>;
  content?: SectionContent;
}

export const SECTION_PRESETS: SectionPreset[] = [
  {
    id: 'text',
    label: 'Text',
    hint: 'Heading and a paragraph',
    kind: 'text',
    content: { heading: 'About the sound', body: 'Tell buyers what this catalogue is for.' },
  },
  {
    id: 'announcement',
    label: 'Announcement band',
    hint: 'Short line on a solid colour',
    kind: 'text',
    base: { background: '#141412', align: 'center', spacing: 3 },
    content: { heading: 'New pack dropping Friday', body: '' },
  },
  {
    id: 'quote',
    label: 'Quote',
    hint: 'Large centred statement',
    kind: 'text',
    base: { align: 'center', width: 'narrow', spacing: 6 },
    content: { heading: '“Made for the late sessions.”', body: '' },
  },
  {
    id: 'banner',
    label: 'Image banner',
    hint: 'Full-width image, darkened, with a heading',
    kind: 'text',
    base: { width: 'full', minHeight: 420, overlay: 40, align: 'center', spacing: 8 },
    content: { heading: 'Your headline', body: 'Set a background image in Style.' },
  },
  {
    id: 'image',
    label: 'Image',
    hint: 'A single picture',
    kind: 'image',
  },
  {
    id: 'video',
    label: 'Video',
    hint: 'YouTube or Vimeo embed',
    kind: 'video',
  },
  {
    id: 'links',
    label: 'Links',
    hint: 'Your socials as buttons',
    kind: 'links',
  },
  {
    id: 'canvas',
    label: 'Free canvas',
    hint: 'Place text and images anywhere',
    kind: 'canvas',
    base: { minHeight: 360 },
  },
];

/** A fresh section from a preset — new id every time, so inserting twice is fine. */
export function sectionFromPreset(preset: SectionPreset): StoreSection {
  const section = createSection(preset.kind, preset.label, preset.base);
  return preset.content ? { ...section, content: { ...preset.content } } : section;
}
