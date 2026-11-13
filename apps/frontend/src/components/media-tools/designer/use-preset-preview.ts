import { useCallback, useEffect } from 'react';
import type { DesignerElement } from './designer.store';

export const usePresetPreview = (store: any) => {
  const preview = useCallback(
    (patches: Record<string, Partial<DesignerElement>>) => {
      store.getState().previewElements(patches);
    },
    [store]
  );

  const cancel = useCallback(() => {
    store.getState().clearElementPreview();
  }, [store]);

  useEffect(() => cancel, [cancel]);

  return { preview, cancel };
};
