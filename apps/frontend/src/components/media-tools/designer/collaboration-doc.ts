import type { createDesignerStore, DesignerDoc } from './designer.store';

type DesignerStoreApi = ReturnType<typeof createDesignerStore>;

export const subscribeToBaseDocument = (
  store: DesignerStoreApi,
  sendUpdate: (doc: DesignerDoc) => void
): (() => void) => {
  sendUpdate(store.getState().doc);
  let previous = store.getState().doc;
  return store.subscribe((state) => {
    if (state.doc === previous) return;
    previous = state.doc;
    sendUpdate(state.doc);
  });
};
