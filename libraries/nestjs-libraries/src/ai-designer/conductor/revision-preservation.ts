import {
  collectDocBackgroundMediaRefs,
  collectDocMediaRefs,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/doc-file-refs';

const PRESERVATION_RE =
  /\b(keep everything else|keep (?:the )?(?:photo|image|picture|background)|(?:do not|don't|dont) change (?:the )?(?:photo|image|picture|background)|only (?:improve|change|edit|fix|adjust|rewrite|make))\b/i;

const MEDIA_WORD_RE = '(?:photo|image|picture|background|imagery)';
const CHANGE_WORD_RE = '(?:regenerat\\w*|replac\\w*|swap\\w*|chang\\w*|switch\\w*|new|different|another|redo)';

const EXPLICIT_MEDIA_REPLACEMENT_RE = new RegExp(
  `\\b${CHANGE_WORD_RE}\\b[^.!?]*\\b${MEDIA_WORD_RE}\\b|\\b${MEDIA_WORD_RE}\\b[^.!?]*\\b${CHANGE_WORD_RE}\\b`,
  'i'
);

export const hasExplicitMediaReplacementRequest = (instruction: string): boolean => {
  const text = instruction || '';
  if (/\b(?:do not|don't|dont)\s+(?:regenerat\w*|replac\w*|swap\w*|chang\w*)\b/i.test(text)) {
    return false;
  }
  if (/\b(colou?r|gradient|tint|shade|shading|darker|lighter|brighter|dimmer|hex)\b|#/i.test(text)) {
    return false;
  }
  return EXPLICIT_MEDIA_REPLACEMENT_RE.test(text);
};

export const shouldPreserveRevisionMedia = (instruction: string): boolean =>
  PRESERVATION_RE.test(instruction || '') &&
  !hasExplicitMediaReplacementRequest(instruction || '');

export const revisionMediaChanged = (
  originalDoc: unknown,
  revisedDoc: unknown,
  _instruction: string
): boolean => {
  const before = collectDocMediaRefs(originalDoc);
  const after = collectDocMediaRefs(revisedDoc);
  if (after.some((ref) => !before.includes(ref))) return true;
  const removed = before.filter((ref) => !after.includes(ref));
  if (!removed.length) return false;
  const originalBackgroundRefs = collectDocBackgroundMediaRefs(originalDoc);
  const revisedBackgroundRefs = collectDocBackgroundMediaRefs(revisedDoc);
  return removed.some(
    (ref) => !originalBackgroundRefs.includes(ref) || revisedBackgroundRefs.includes(ref)
  );
};
