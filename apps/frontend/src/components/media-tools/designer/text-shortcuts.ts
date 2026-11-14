import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import type { MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import type { DesignerOutput, VideoOutput } from './designer.store';
import { fittedFontSize, growBoxFor } from './measure-text';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

export const boundedFontSize = (current: number | undefined, delta: number): number =>
  Math.max(1, Math.min(MAX_FONT_SIZE, Math.round((current || 16) + delta)));

export const fontSizeShortcutDelta = (event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): -1 | 0 | 1 => {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey) return 0;
  if (event.key === '<') return -1;
  if (event.key === '>') return 1;
  if (!event.shiftKey || /^[a-z]$/i.test(event.key)) return 0;
  if (event.code === 'Comma') return -1;
  if (event.code === 'Period') return 1;
  return 0;
};

export const adjustSelectedTextFontSize = (
  store: Store,
  delta: number,
  measure?: MeasureText
): boolean => {
  const state = store.getState();
  let changed = false;

  if (state.doc.mode === 'video') {
    const output = state.doc.outputs[state.currentOutput] as VideoOutput | undefined;
    if (!output) return false;
    const refs = state.selectedClips.length
      ? state.selectedClips
      : state.selectedClip
        ? [state.selectedClip]
        : [];
    for (const ref of refs) {
      const track = output.tracks.find((item) => item.id === ref.trackId);
      if (!track || track.locked || (track.type !== 'text' && track.type !== 'caption')) continue;
      const clip = track.clips.find((item) => item.id === ref.clipId);
      if (!clip) continue;
      const fallback = track.type === 'caption' ? 28 : 16;
      const fontSize = boundedFontSize(clip.fontSize ?? fallback, delta);
      if (fontSize === (clip.fontSize ?? fallback)) continue;
      changed = state.updateClipSilent(state.currentOutput, track.id, clip.id, { fontSize }) || changed;
    }
  } else {
    const output = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
    const elements = output ? pageChildren(output, state.currentPage) : [];
    for (const element of elements) {
      if (!state.selectedIds.includes(element.id) || element.type !== 'text' || element.locked || element.hidden) {
        continue;
      }
      const authoredSize = element.fontSize ?? 16;
      const effectiveSize = fittedFontSize(element);
      const fontSize = boundedFontSize(effectiveSize, delta);
      const richText = element.richText?.map((run) => ({
        ...run,
        fontSize: boundedFontSize(run.fontSize ?? authoredSize, delta),
      }));
      const runsChanged = richText?.some((run, index) =>
        run.fontSize !== (element.richText?.[index].fontSize ?? authoredSize)
      );
      if (fontSize === effectiveSize && !runsChanged) continue;
      const growth = delta > 0 && effectiveSize === authoredSize
        ? growBoxFor(
            { ...element, fontSize, richText },
            fontSize,
            measure,
            { width: output.width, height: output.height }
          )
        : {};
      state.updateElementsSilent([element.id], { fontSize, richText, ...growth });
      changed = true;
    }
  }

  if (changed) store.getState().pushHistory('Change font size');
  return changed;
};
