import type { DesignerDoc } from './designer.store';

/**
 * "Blank" = the doc carries no real content, whatever its mode: image outputs
 * have no elements on page 1 (`children`) NOR on any extra page (`pages[]`),
 * video outputs have no clips on any track. Unlike template-mode's isDocEmpty
 * (an apply-guard that predates pages), this one also walks `pages[]` — a
 * design whose only content sits on page 2+ is not blank.
 *
 * Used by the autosave gate: a brand-new design that is still blank is never
 * POSTed, so closing the editor without touching the canvas leaves no row.
 */

interface BlankCheckOutput {
  children?: unknown[] | null;
  pages?: Array<{ children?: unknown[] | null }> | null;
  tracks?: Array<{ clips?: unknown[] | null }> | null;
}

export const isBlankDoc = (doc: DesignerDoc | null | undefined): boolean => {
  const outputs = (doc?.outputs ?? []) as BlankCheckOutput[];
  if (!outputs.length) return true;
  return outputs.every((output) => {
    if (Array.isArray(output.tracks)) {
      return (output.tracks ?? []).every((track) => (track?.clips ?? []).length === 0);
    }
    if ((output.children ?? []).length > 0) return false;
    return (output.pages ?? []).every((page) => (page?.children ?? []).length === 0);
  });
};
