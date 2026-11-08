import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { alignBox, alignmentFrame, distribute, type DistributeMode } from '@postmill-ai/nestjs-libraries/media/designer-doc/align-distribute';

export type DesignerSuggestionAction =
  | { type: 'align'; position: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }
  | { type: 'distribute'; mode: DistributeMode };

export type DesignerSuggestionScope = {
  mode: 'image' | 'video';
  outputIndex: number;
  pageNumber: number;
  selectedIds: string[];
};

export type DesignerSuggestionActionStatus =
  | 'ready'
  | 'stale'
  | 'needs-selection'
  | 'needs-three'
  | 'unsupported';

type Store = ReturnType<typeof import('../designer.store').createDesignerStore>;

export const captureDesignerSuggestionScope = (store: Store): DesignerSuggestionScope => {
  const state = store.getState();
  return {
    mode: state.doc.mode || 'image',
    outputIndex: state.currentOutput,
    pageNumber: state.currentPage,
    selectedIds: [...state.selectedIds],
  };
};

export const designerSuggestionSelection = (store: Store) => {
  const state = store.getState();
  if (state.doc.mode === 'video') return [];
  const output = state.doc.outputs[state.currentOutput];
  if (!output || !('children' in output)) return [];
  const selected = new Set(state.selectedIds);
  return pageChildren(output, state.currentPage)
    .filter((element) => selected.has(element.id))
    .slice(0, 50)
    .map((element) => ({
      type: element.type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
    }));
};

export const designerSuggestionActionStatus = (
  store: Store,
  action: DesignerSuggestionAction,
  scope: DesignerSuggestionScope,
): DesignerSuggestionActionStatus => {
  const state = store.getState();
  const selectedIds = new Set(state.selectedIds);
  const sameSelection = selectedIds.size === scope.selectedIds.length &&
    scope.selectedIds.every((id) => selectedIds.has(id));
  if (
    (state.doc.mode || 'image') !== scope.mode ||
    state.currentOutput !== scope.outputIndex ||
    state.currentPage !== scope.pageNumber ||
    !sameSelection
  ) {
    return 'stale';
  }
  if (scope.mode !== 'image') return 'unsupported';
  const output = state.doc.outputs[state.currentOutput];
  if (!output || !('children' in output)) return 'stale';
  if (!scope.selectedIds.length) return 'needs-selection';
  if (action.type === 'distribute' && scope.selectedIds.length < 3) return 'needs-three';
  return 'ready';
};

export const applyDesignerSuggestionAction = (
  store: Store,
  action: DesignerSuggestionAction,
  scope: DesignerSuggestionScope,
): DesignerSuggestionActionStatus => {
  const status = designerSuggestionActionStatus(store, action, scope);
  if (status !== 'ready') return status;

  const state = store.getState();
  const output = state.doc.outputs[state.currentOutput];
  if (!output || !('children' in output)) return 'stale';
  const selected = new Set(state.selectedIds);
  const elements = pageChildren(output, state.currentPage)
    .filter((element) => selected.has(element.id));
  if (!elements.length || (action.type === 'distribute' && elements.length < 3)) {
    return 'stale';
  }

  if (action.type === 'distribute') {
    const patches = distribute(elements, action.mode);
    for (const element of elements) {
      const patch = patches[element.id];
      if (patch) state.updateElement(element.id, patch);
    }
  } else {
    const frame = alignmentFrame(elements, output);
    for (const element of elements) {
      state.updateElement(element.id, alignBox(element, action.position, frame));
    }
  }

  state.pushHistory('Apply design suggestion');
  return 'ready';
};
