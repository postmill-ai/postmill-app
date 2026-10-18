/**
 * Page accessors for multi-page image outputs (doc v8).
 *
 * A page is addressed by a 0-based `pageNumber` where 0 is the output itself
 * (`output.children` / `output.bg`) and n ≥ 1 is `output.pages[n - 1]`. Pages
 * carry no size — the output's canvas is shared. Shared by the frontend store
 * and the server renderer/ops so both read the same rules; no zod here.
 */
import type {
  DesignerBackground,
  DesignerElement,
  DesignerOutput,
  DesignerPageContent,
} from './designer-doc.schema';
import { MAX_PAGES_PER_OUTPUT } from './designer-doc.limits';
import { genId } from './designer-doc.migrate';

/** Total page count of an output, including page 1 (`output.children`). */
export const pageCount = (output: Pick<DesignerOutput, 'pages'>): number =>
  1 + (output.pages?.length ?? 0);

/** True when the pageNumber addresses a real page of this output. */
export const isValidPage = (
  output: Pick<DesignerOutput, 'pages'>,
  pageNumber: number
): boolean =>
  Number.isInteger(pageNumber) && pageNumber >= 0 && pageNumber < pageCount(output);

/**
 * Elements of a page. Out-of-range pageNumbers resolve to page 1's children so
 * a stale `currentPage` after an undo/remove can never blank the canvas.
 */
export const pageChildren = (
  output: Pick<DesignerOutput, 'children' | 'pages'>,
  pageNumber: number
): DesignerElement[] => {
  if (pageNumber <= 0) return output.children ?? [];
  return output.pages?.[pageNumber - 1]?.children ?? output.children ?? [];
};

/**
 * Effective background of a page: the page's own override when set, else the
 * output-level `bg`. (The legacy flat `background` color string stays on the
 * output and is not overridden per page.)
 */
export const pageBackground = (
  output: Pick<DesignerOutput, 'bg' | 'pages'>,
  pageNumber: number
): DesignerBackground | undefined => {
  if (pageNumber <= 0) return output.bg;
  return output.pages?.[pageNumber - 1]?.background ?? output.bg;
};

/** Display name of a page: its own name, else a 1-based ordinal label. */
export const pageName = (
  output: Pick<DesignerOutput, 'pages'>,
  pageNumber: number
): string =>
  (pageNumber > 0 && output.pages?.[pageNumber - 1]?.name) ||
  `Page ${pageNumber + 1}`;

/**
 * Immutable write of a page's children — the write-side counterpart of
 * `pageChildren`. Page 0 writes `output.children`; n ≥ 1 writes
 * `output.pages[n - 1].children` (no-op object when the page does not exist).
 */
export const withPageChildren = (
  output: DesignerOutput,
  pageNumber: number,
  children: DesignerElement[]
): DesignerOutput => {
  if (pageNumber <= 0 || !output.pages?.[pageNumber - 1]) {
    return pageNumber <= 0 ? { ...output, children } : output;
  }
  const pages = output.pages.map((p, i) =>
    i === pageNumber - 1 ? { ...p, children } : p
  );
  return { ...output, pages };
};

/** Append a page. Returns null when the output is already at the cap. */
export const appendPage = (
  output: DesignerOutput,
  page: DesignerPageContent
): DesignerOutput | null => {
  if (pageCount(output) >= MAX_PAGES_PER_OUTPUT) return null;
  return { ...output, pages: [...(output.pages ?? []), page] };
};

/**
 * Remove page `pageNumber` (0-based). Page 1 (pageNumber 0) cannot be removed —
 * it is the output itself; returns null in that case.
 */
export const removePageAt = (
  output: DesignerOutput,
  pageNumber: number
): DesignerOutput | null => {
  if (pageNumber <= 0 || !output.pages?.[pageNumber - 1]) return null;
  const pages = output.pages.filter((_, i) => i !== pageNumber - 1);
  return { ...output, pages: pages.length ? pages : undefined };
};

/**
 * Move a page across the FULL page range [0..pageCount). Each page travels as
 * a {name, background, children} bundle; the base slot (page 1) contributes
 * `{background: undefined, children: output.children}` — "inherits output.bg".
 * When a page with a background override lands on the base slot its override
 * is promoted to `output.bg` (the shared canvas default); a page leaving the
 * base slot carries no override, so it inherits whatever the new default is.
 */
export const movePage = (
  output: DesignerOutput,
  from: number,
  to: number
): DesignerOutput | null => {
  const count = pageCount(output);
  if (from === to || from < 0 || to < 0 || from >= count || to >= count) {
    return null;
  }
  const all: DesignerPageContent[] = [
    { id: genId(), children: output.children },
    ...(output.pages ?? []),
  ];
  const [moved] = all.splice(from, 1);
  all.splice(to, 0, moved);
  const [first, ...rest] = all;
  const promotedBg = first.background ?? output.bg;
  return {
    ...output,
    children: first.children,
    bg: promotedBg,
    background:
      promotedBg?.type === 'color' && promotedBg.color
        ? promotedBg.color
        : output.background,
    pages: rest.length ? rest : undefined,
  };
};

/**
 * Deep-clone a page into a NEW page inserted right after it. Every element
 * gets a fresh id AND a fresh originId — a duplicate that kept the source's
 * originIds would read as linked to page 1 even though per-page edits are
 * deliberately local. Returns null at the cap or on a bogus pageNumber.
 */
export const duplicatePageAt = (
  output: DesignerOutput,
  pageNumber: number,
  newPageId?: string
): DesignerOutput | null => {
  if (
    !isValidPage(output, pageNumber) ||
    pageCount(output) >= MAX_PAGES_PER_OUTPUT
  ) {
    return null;
  }
  const sourceBg = pageBackground(output, pageNumber);
  const copy: DesignerPageContent = {
    id: newPageId ?? genId(),
    background: sourceBg ? JSON.parse(JSON.stringify(sourceBg)) : undefined,
    children: pageChildren(output, pageNumber).map((el) => ({
      ...JSON.parse(JSON.stringify(el)),
      id: genId(),
      originId: genId(),
    })),
  };
  const pages = [...(output.pages ?? [])];
  // pageNumber 0 inserts at the head of the extras array (as page 2).
  pages.splice(pageNumber, 0, copy);
  return { ...output, pages };
};
