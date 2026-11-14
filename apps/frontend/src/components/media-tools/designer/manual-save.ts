import type { createDesignerStore } from './designer.store';
import type { DesignAutosave, SaveResult } from './designer-autosave';

type DesignerStoreApi = ReturnType<typeof createDesignerStore>;

export const manualSaveToastKind = (result: SaveResult): 'success' | 'neutral' | 'warning' =>
  result === 'persisted' ? 'success' : result === 'skipped' ? 'neutral' : 'warning';

export const runManualSave = async (
  store: DesignerStoreApi,
  designAutosave: DesignAutosave
): Promise<SaveResult> => {
  if (!store.getState().designId) await designAutosave.ensureCreated();
  const state = store.getState();
  if (!state.designId) return 'failed';
  return state.isDirty ? designAutosave.saveNow(state.doc) : 'persisted';
};
