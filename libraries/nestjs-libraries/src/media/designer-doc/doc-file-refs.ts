/**
 * Every fileId a designer doc references: image elements and output
 * backgrounds carry `fileId` (alongside `src`), and that pointer is what keeps
 * an asset File row alive once the AI Designer session that minted it is gone.
 * A JSON-string scan is deliberate: doc shapes evolve (outputs, children,
 * tracks, clips) and a structural walk would silently miss new carriers.
 */
const FILE_ID_RE = /"fileId"\s*:\s*"([^"]+)"/g;

export function collectDocFileIds(doc: unknown): Set<string> {
  const ids = new Set<string>();
  if (!doc) return ids;
  const json = JSON.stringify(doc);
  for (const match of json.matchAll(FILE_ID_RE)) {
    ids.add(match[1]);
  }
  return ids;
}

/**
 * Every fontFamily a doc names (text elements, text runs, clips, symbol
 * definitions). Same deliberate JSON-scan rationale as collectDocFileIds.
 * Values include built-in catalog families — callers intersect with the org's
 * custom fonts before doing anything with them.
 */
const FONT_FAMILY_RE = /"fontFamily"\s*:\s*"([^"]+)"/g;

export function collectDocFontFamilies(doc: unknown): Set<string> {
  const families = new Set<string>();
  if (!doc) return families;
  const json = JSON.stringify(doc);
  for (const match of json.matchAll(FONT_FAMILY_RE)) {
    families.add(match[1]);
  }
  return families;
}

/** Where a remapped id lands: the new File row id + the new storage path. */
export interface FileRefRemap {
  id: string;
  path: string;
}

const REF_ID_KEYS = new Set(['fileId', 'originalFileId', 'maskFileId']);
const SRC_KEY_FOR: Record<string, string> = {
  fileId: 'src',
  originalFileId: 'originalSrc',
  maskFileId: 'maskSrc',
};

/**
 * True for srcs that point at this instance's own storage (`/uploads/…`,
 * relative or absolute). Remote http(s) and data: srcs are left untouched —
 * they resolve from anywhere and must not be rewritten to a local path.
 */
const isUploadsSrc = (src: unknown): src is string => {
  if (typeof src !== 'string') return false;
  if (src.startsWith('/uploads/') || src.startsWith('uploads/')) return true;
  if (!/^https?:\/\//i.test(src)) return false;
  try {
    return new URL(src).pathname.startsWith('/uploads/');
  } catch {
    return false;
  }
};

/**
 * Rewrite a doc's file references after a `.pdesign` v2 import re-uploaded the
 * bundled assets: every fileId/originalFileId/maskFileId value present in
 * `map` becomes the new File id, and the PAIRED same-origin `/uploads/…` src
 * (src/originalSrc/maskSrc on the same object) follows to the new path — the
 * id and the URL travel together (video clips carry extensionless /uploads
 * URLs next to the fileId).
 *
 * Shape-agnostic like collectDocFileIds: a recursive key walk, so future
 * carriers (new element/clip kinds) are rewritten without a code change.
 * Returns a deep-mutated CLONE — the input doc is never touched.
 */
export function rewriteDocFileRefs<T>(doc: T, map: ReadonlyMap<string, FileRefRemap>): T {
  if (!doc || map.size === 0) return doc;
  const root = structuredClone(doc);

  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      if (REF_ID_KEYS.has(key) && typeof obj[key] === 'string') {
        const remap = map.get(obj[key] as string);
        if (remap) {
          obj[key] = remap.id;
          const srcKey = SRC_KEY_FOR[key];
          if (isUploadsSrc(obj[srcKey])) {
            obj[srcKey] = remap.path;
          }
        }
        continue;
      }
      walk(obj[key]);
    }
  };

  walk(root);
  return root;
}
