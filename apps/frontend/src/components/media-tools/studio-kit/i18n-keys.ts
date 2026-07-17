// Deterministic i18next key derivation for Studio Kit descriptor text.
//
// SHARED by the render layer (studio-form / studio-shell / studio-landing) and the
// build-time translation extractor, so descriptor keys always align between where the
// text renders and where its translations are authored. See dev/I18N_UPDATE.md §3.6.
//
// Flat, underscore-only keys — NEVER '.' or ':' (i18next default separators). `provider`
// is NOT unique per studio (e.g. Pika rides `fal`, Sora rides `openai`), so the studio
// namespace combines provider + title (a stable brand noun, itself left untranslated).

const seg = (x: string | number): string =>
  String(x)
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

/** Per-studio namespace, e.g. `studio_fal_pika`. */
export const studioNs = (provider: string, title: string): string =>
  `studio_${seg(provider)}_${seg(title)}`;

export const studioTabKey = (ns: string, tabKey: string): string =>
  `${ns}_${seg(tabKey)}_tab`;
export const studioTabDescKey = (ns: string, tabKey: string): string =>
  `${ns}_${seg(tabKey)}_desc`;
export const studioFieldKey = (
  ns: string,
  tabKey: string,
  fieldName: string,
  slot: 'label' | 'help' | 'placeholder'
): string => `${ns}_${seg(tabKey)}_${seg(fieldName)}_${slot}`;
export const studioOptionKey = (
  ns: string,
  tabKey: string,
  fieldName: string,
  index: number
): string => `${ns}_${seg(tabKey)}_${seg(fieldName)}_opt${index}`;

export const studioLandingTaglineKey = (ns: string): string => `${ns}_landing_tagline`;
export const studioLandingDescKey = (ns: string): string => `${ns}_landing_desc`;
export const studioLandingHighlightKey = (ns: string, index: number): string =>
  `${ns}_landing_hl${index}`;

/** Capability badges (Image / Video / Audio / …) are shared across studios → global key. */
export const studioBadgeKey = (badge: string): string => `studio_badge_${seg(badge)}`;
