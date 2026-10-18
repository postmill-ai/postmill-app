/**
 * "Blank" = the doc carries no real content, whatever its mode: image outputs
 * have no elements on page 1 (`children`) NOR on any extra page (`pages[]`),
 * video outputs have no clips on any track. This walks `pages[]` too — a
 * design whose only content sits on page 2+ is not blank.
 *
 * Used by the retention sweep (purge saved-but-blank canvases) and by preview
 * maintenance (a blank doc has nothing to render). A frontend twin lives at
 * `apps/frontend/src/components/media-tools/designer/designer-doc-blank.ts`
 * (autosave gate) — keep the semantics in lockstep.
 */

interface BlankCheckOutput {
  children?: unknown[] | null;
  pages?: Array<{ children?: unknown[] | null }> | null;
  tracks?: Array<{ clips?: unknown[] | null }> | null;
}

export const isBlankDoc = (
  doc: { outputs?: unknown } | null | undefined
): boolean => {
  const outputs = ((doc?.outputs ?? []) as BlankCheckOutput[]) ?? [];
  if (!Array.isArray(outputs) || !outputs.length) return true;
  return outputs.every((output) => {
    if (Array.isArray(output?.tracks)) {
      return (output.tracks ?? []).every(
        (track) => (track?.clips ?? []).length === 0
      );
    }
    if ((output?.children ?? []).length > 0) return false;
    return (output?.pages ?? []).every(
      (page) => (page?.children ?? []).length === 0
    );
  });
};
