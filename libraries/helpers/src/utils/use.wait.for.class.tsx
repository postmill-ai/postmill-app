'use client';

import { useCallback, useSyncExternalStore } from "react";

/**
 * useWaitForClass
 *
 * Watches the DOM for the presence of a CSS class and resolves when found.
 *
 * @param className - The class to wait for (without the dot, e.g. "my-element")
 * @param root - The root node to observe (defaults to document.body)
 * @returns A boolean indicating if the class is currently present
 */
export function useWaitForClass(className: string, root: HTMLElement | null = null): boolean {
  const subscribe = useCallback(
    (callback: () => void) => {
      const target = root ?? document.body;
      if (!target) {
        return () => {};
      }

      const observer = new MutationObserver(callback);
      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      return () => observer.disconnect();
    },
    [className, root]
  );

  const getSnapshot = useCallback(() => {
    const target = root ?? document.body;
    if (!target) {
      return false;
    }
    return !!target.querySelector(`.${className}`);
  }, [className, root]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
