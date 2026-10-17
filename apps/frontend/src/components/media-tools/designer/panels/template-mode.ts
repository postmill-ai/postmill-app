/**
 * Mode awareness for the Designer template gallery: deriving a template's mode
 * from its stored doc (the badge), detecting an untouched canvas, and deciding
 * whether applying a template needs the cross-mode confirm. Pure module so the
 * guard rules are unit-testable without rendering the panel.
 */

export type TemplateMode = 'image' | 'video';

export interface ModeCarrier {
  doc?: { mode?: string | null } | null;
}

/** Anything missing a doc/mode is an image template — the pre-video default. */
export const templateModeOf = (template: ModeCarrier): TemplateMode =>
  template.doc?.mode === 'video' ? 'video' : 'image';

export interface DocLike {
  mode?: string | null;
  outputs?: Array<{
    children?: unknown[] | null;
    tracks?: Array<{ clips?: unknown[] | null }> | null;
  }> | null;
}

/**
 * True when the doc carries no user content: image docs have no elements on
 * any output, video docs have no clips on any track. An empty doc is safe to
 * replace without asking, whatever its mode.
 */
export const isDocEmpty = (doc: DocLike | null | undefined): boolean => {
  if (!doc?.outputs?.length) return true;
  if (doc.mode === 'video') {
    return doc.outputs.every((output) =>
      (output.tracks ?? []).every((track) => !(track.clips ?? []).length)
    );
  }
  return doc.outputs.every((output) => !(output.children ?? []).length);
};

/**
 * Applying across modes replaces the open design (loadDesign takes the
 * template's mode). Confirm only when the current design has something to
 * lose — an empty/untouched canvas converts silently.
 */
export const needsModeConfirm = (
  template: ModeCarrier,
  currentDoc: DocLike | null | undefined
): boolean => {
  const currentMode: TemplateMode = currentDoc?.mode === 'video' ? 'video' : 'image';
  return templateModeOf(template) !== currentMode && !isDocEmpty(currentDoc);
};
