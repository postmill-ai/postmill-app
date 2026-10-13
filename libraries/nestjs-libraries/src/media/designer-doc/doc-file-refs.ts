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
