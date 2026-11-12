import { MAX_FONT_SIZE } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.limits';
import type { MeasureText } from '@postmill-ai/nestjs-libraries/media/designer-doc/fit-text';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import type { DesignerOutput, VideoOutput } from './designer.store';
import { growBoxFor } from './measure-text';
import { buildTextElementPatch } from './panels/text-format-panel';

type Store = ReturnType<typeof import('./designer.store').createDesignerStore>;

const boundedFontSize = (current: number | undefined, delta: number): number =>
  Math.max(1, Math.min(MAX_FONT_SIZE, Math.round((current || 16) + delta)));

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
      const fontSize = boundedFontSize(clip.fontSize, delta);
      if (fontSize === (clip.fontSize || 16)) continue;
      changed = state.updateClipSilent(state.currentOutput, track.id, clip.id, { fontSize }) || changed;
    }
  } else {
    const output = state.doc.outputs[state.currentOutput] as DesignerOutput | undefined;
    const elements = output ? pageChildren(output, state.currentPage) : [];
    for (const element of elements) {
      if (!state.selectedIds.includes(element.id) || element.type !== 'text' || element.locked || element.hidden) {
        continue;
      }
      const fontSize = boundedFontSize(element.fontSize, delta);
      if (fontSize === (element.fontSize || 16)) continue;
      const patch = buildTextElementPatch(element, { fontSize }, null);
      const next = { ...element, ...patch };
      state.updateElement(element.id, {
        ...patch,
        ...growBoxFor(next, fontSize, measure),
      });
      changed = true;
    }
  }

  if (changed) store.getState().pushHistory('Change font size');
  return changed;
};
