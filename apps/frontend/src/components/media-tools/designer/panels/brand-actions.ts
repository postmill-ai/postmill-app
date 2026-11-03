import { addImageClipToTimeline } from '../add-media-to-timeline';
import { probeImageNaturalSize } from '../elements';
import { fitWithin } from './fit-within';

type Store = ReturnType<typeof import('../designer.store').createDesignerStore>;

const selectedVideoTarget = (store: Store, allowedTypes: string[]) => {
  const state = store.getState();
  const selection = state.selectedClip;
  if (!selection) return null;
  const output = state.doc.outputs[state.currentOutput] as any;
  const track = output?.tracks?.find((item: any) => item.id === selection.trackId);
  const clip = track?.clips?.find((item: any) => item.id === selection.clipId);
  if (!track || !clip || !allowedTypes.includes(track.type)) return null;
  return { selection, track, clip };
};

export const applyBrandColor = (store: Store, color: string): boolean => {
  const state = store.getState();
  if (state.doc.mode === 'video') {
    const target = selectedVideoTarget(store, ['text', 'caption', 'shape']);
    if (!target) return false;
    state.updateClip(state.currentOutput, target.selection.trackId, target.selection.clipId, { fill: color });
    return true;
  }
  if (state.selectedIds.length !== 1) return false;
  state.updateElement(state.selectedIds[0], { fill: color });
  state.pushHistory('Apply brand color');
  return true;
};

export const applyBrandFont = (store: Store, fontFamily: string): boolean => {
  const state = store.getState();
  if (state.doc.mode === 'video') {
    const target = selectedVideoTarget(store, ['text', 'caption']);
    if (!target) return false;
    state.updateClip(state.currentOutput, target.selection.trackId, target.selection.clipId, { fontFamily });
    return true;
  }
  if (state.selectedIds.length !== 1) return false;
  const output = state.doc.outputs[state.currentOutput] as any;
  const selected = output?.children?.find((element: any) => element.id === state.selectedIds[0]);
  if (selected?.type !== 'text') return false;
  state.updateElement(selected.id, { fontFamily });
  state.pushHistory('Apply brand font');
  return true;
};

export const addBrandLogo = async (
  store: Store,
  file: { id: string; path: string },
  probe = probeImageNaturalSize
): Promise<boolean> => {
  const state = store.getState();
  if (state.doc.mode === 'video') {
    return !!addImageClipToTimeline(store, { url: file.path, fileId: file.id });
  }
  const output = state.doc.outputs[state.currentOutput];
  const natural = await probe(file.path);
  const fallbackSide = Math.min(300, output.width * 0.5);
  const size = natural
    ? fitWithin(natural.width, natural.height, output.width * 0.5, output.height * 0.5)
    : { width: fallbackSide, height: fallbackSide };
  state.addElement({
    id: '',
    type: 'image',
    x: Math.round((output.width - size.width) / 2),
    y: Math.round((output.height - size.height) / 2),
    width: size.width,
    height: size.height,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    src: file.path,
    fileId: file.id,
    naturalWidth: natural?.width,
    naturalHeight: natural?.height,
  });
  return true;
};
