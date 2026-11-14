import type { createDesignerStore, DesignerDoc } from './designer.store';

type DesignerStoreApi = ReturnType<typeof createDesignerStore>;

export const subscribeToBaseDocument = (
  store: DesignerStoreApi,
  sendUpdate: (doc: DesignerDoc) => void
): (() => void) => {
  sendUpdate(store.getState().doc);
  let lastSent = store.getState().doc;
  return store.subscribe((state) => {
    if (state.gestureDepth > 0 || state.doc === lastSent) return;
    lastSent = state.doc;
    sendUpdate(state.doc);
  });
};
