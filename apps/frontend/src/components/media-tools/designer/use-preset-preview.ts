import { useCallback, useEffect, useRef } from 'react';
import type { DesignerElement } from './designer.store';

type PreviewPatches = Record<string, Partial<DesignerElement>>;

export const usePresetPreview = (store: any) => {
  const generation = useRef(0);
  const preview = useCallback(
    (patches: PreviewPatches) => {
      generation.current += 1;
      store.getState().previewElements(patches);
    },
    [store]
  );

  const previewAsync = useCallback(
    async (load: () => Promise<PreviewPatches>) => {
      const request = ++generation.current;
      try {
        const patches = await load();
        if (generation.current === request) store.getState().previewElements(patches);
      } catch {
        // A failed font load leaves the base canvas untouched.
      }
    },
    [store]
  );

  const applyAsync = useCallback(
    async (load: () => Promise<() => void>) => {
      const request = ++generation.current;
      try {
        const commit = await load();
        if (generation.current === request) commit();
      } catch {
        // A failed font load leaves the base document and history untouched.
      }
    },
    []
  );

  const cancel = useCallback(() => {
    generation.current += 1;
    store.getState().clearElementPreview();
  }, [store]);

  useEffect(() => cancel, [cancel]);

  return { preview, previewAsync, applyAsync, cancel };
};
