import type { createDesignerStore } from './designer.store';

type DesignerStoreApi = ReturnType<typeof createDesignerStore>;

export const runGestureCommit = async (
  store: DesignerStoreApi,
  commit: () => void | Promise<void>,
  onEnd?: () => void,
  shouldEnd: () => boolean = () => true
): Promise<void> => {
  try {
    await commit();
  } finally {
    try {
      onEnd?.();
    } finally {
      if (shouldEnd()) store.getState().endGesture();
    }
  }
};
