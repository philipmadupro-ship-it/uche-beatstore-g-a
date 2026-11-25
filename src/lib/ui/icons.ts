import {
  AlertCircle, AudioLines, CheckCircle2, CircleX, CloudDownload, CloudOff, Coins, Download,
  ExternalLink, FileSignature, FileText, HandCoins, Landmark, Library, Link2, Loader2,
  MoreHorizontal, Pencil, Receipt, Send, Settings, Share2, ShoppingBag, ShoppingCart,
  SlidersHorizontal, Store, Trash2, TriangleAlert, Upload, WifiOff, X,
  type LucideIcon,
} from 'lucide-react';

/**
 * The icon vocabulary: one concept, one lucide icon.
 *
 * lucide-react is the only icon set. The audit (UI-02) found the same idea drawn
 * three ways: a warning as AlertTriangle / TriangleAlert, success as CheckCircle /
 * CheckCircle2, edit as Edit2 / Edit3 / Pencil, upload as Upload in one place and
 * a Plus in another. A reader learns an icon's meaning from where they have seen
 * it before, so two drawings for one concept make both of them mean less.
 *
 * Extend this map rather than picking an icon inline when a concept already
 * exists. Concepts that are genuinely different keep different icons:
 *   - `settings` is the gear (account / app settings); `tune` is the sliders for
 *     filters and per-item options. They were interchangeable before.
 *   - `delete` (Trash2) destroys; `dismiss` (X) only closes or removes from view.
 *   - `sales` (bag) is a completed purchase; `cart` is the basket being filled.
 *   - `offline` is the state / page; `saveOffline` is the action of making
 *     something available there; `noConnection` is the connectivity indicator.
 *
 * Pure: no React state, nothing here renders. The guard test is
 * `icons.test.ts`; `/dev/design-system` shows the map.
 */
export const ICONS = {
  store: Store,
  sales: ShoppingBag,
  cart: ShoppingCart,
  library: Library,
  studio: AudioLines,
  upload: Upload,
  download: Download,
  offline: CloudOff,
  saveOffline: CloudDownload,
  noConnection: WifiOff,
  share: Share2,
  send: Send,
  link: Link2,
  external: ExternalLink,
  delete: Trash2,
  dismiss: X,
  settings: Settings,
  tune: SlidersHorizontal,
  contract: FileSignature,
  document: FileText,
  edit: Pencil,
  more: MoreHorizontal,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
  failed: CircleX,
  loading: Loader2,
  // Finance: four different questions, four different drawings.
  financeOverview: Coins,
  financeEarnings: HandCoins,
  financeAdvances: Landmark,
  financeStatements: Receipt,
} as const satisfies Record<string, LucideIcon>;

export type IconConcept = keyof typeof ICONS;

/**
 * Sizes by role, in px. Everything in the app sat on a 9–16 spread for the same
 * "icon in a button" role (9, 10, 11, 12, 13, 14, 15, 16 all appeared), so two
 * buttons next to each other differed by a pixel or two for no reason.
 */
export const ICON_SIZE = {
  /** Inline with 10–12px text, chips, badges. */
  xs: 12,
  /** Inside buttons and menu rows. */
  sm: 14,
  /** Standalone controls and nav rows. */
  md: 16,
  /** Top-bar actions and headings. */
  lg: 20,
  /** Empty states and heroes. */
  xl: 24,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/** Stroke widths. Lucide's own default (2) unless a large icon wants a thinner line. */
export const ICON_STROKE = {
  default: 2,
  /** 24px and up, where a 2px line reads heavy. Also the nav menu rows. */
  thin: 1.75,
  /** Check marks only: small and must read at a glance. */
  bold: 2.5,
} as const;

export const ICON_SIZES: readonly number[] = Object.values(ICON_SIZE);
export const ICON_STROKES: readonly number[] = Object.values(ICON_STROKE);

/**
 * Names of lucide exports that were retired in favour of a mapped icon, and what
 * replaces them. Importing one is a guard-test failure (`icons.test.ts`).
 * Several are aliases of another export, so the swap is visually a no-op; the
 * point is that a search for "which icon means warning" finds one answer.
 */
export const RETIRED_ICONS: Readonly<Record<string, string>> = {
  AlertTriangle: 'TriangleAlert',
  CheckCircle: 'CheckCircle2',
  XCircle: 'CircleX',
  Edit2: 'Pencil',
  Edit3: 'Pencil',
  Settings2: 'SlidersHorizontal',
};

/** "saveOffline" → "Save offline", "financeEarnings" → "Finance · earnings". For the gallery. */
export function iconLabel(concept: IconConcept): string {
  const words = concept.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(' ');
  const head = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  if (head === 'Finance' && words.length > 1) return `${head} · ${words.slice(1).join(' ')}`;
  return [head, ...words.slice(1)].join(' ');
}
