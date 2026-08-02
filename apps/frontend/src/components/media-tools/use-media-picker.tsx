'use client';

import React, { useCallback, useState } from 'react';
import {
  MediaSelectorModal,
  type MediaSelectorModalProps,
} from '@postmill-ai/frontend/components/media-tools/media-selector-modal';

/**
 * The one sanctioned way to open the media picker.
 *
 * Every surface used to hand-roll `useState(open)` + `<MediaSelectorModal open …/>`,
 * and seven of them additionally wrapped it in `openModal({ title })` — which
 * produced a dialog inside a dialog with a different header per caller. This
 * hook is the single entry point, so the chrome cannot diverge again.
 *
 * **Never wrap the picker in `useModals().openModal`.** Beyond the double chrome,
 * `openModal` snapshots `children` into a zustand store (`new-modal.tsx`), so any
 * callback closed over host state is frozen at open time — which would silently
 * break the composer, whose media callbacks run per-item after the picker closes.
 * This hook builds the element during render instead, so callbacks are always the
 * newest closure. A guard spec enforces the rule.
 *
 * ```tsx
 * const picker = useMediaPicker({ title: t('background_image', 'Background image'), onSelect });
 * return <><button onClick={picker.open} />{picker.element}</>;
 * ```
 */
export type MediaPickerOptions = Omit<MediaSelectorModalProps, 'open' | 'onClose'>;

export interface MediaPicker {
  /**
   * Takes no arguments so it is safe to pass straight to `onClick` — an
   * `(overrides?) => void` signature would spread the MouseEvent into the
   * picker's props.
   */
  open: () => void;
  /** Open with per-call overrides merged over the hook's options. */
  openWith: (overrides: MediaPickerOptions) => void;
  close: () => void;
  isOpen: boolean;
  /** Render this in your JSX. `null` while closed. */
  element: React.ReactNode;
}

export const useMediaPicker = (options: MediaPickerOptions = {}): MediaPicker => {
  const [isOpen, setIsOpen] = useState(false);
  const [overrides, setOverrides] = useState<MediaPickerOptions | null>(null);

  const open = useCallback(() => {
    setOverrides(null);
    setIsOpen(true);
  }, []);

  const openWith = useCallback((next: MediaPickerOptions) => {
    setOverrides(next);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setOverrides(null);
  }, []);

  // Built during render, deliberately not memoised: the props (and the closures
  // inside them) must be this render's, not the ones captured when it opened.
  // Per-open overrides win over the hook's defaults.
  const element = isOpen ? (
    <MediaSelectorModal open onClose={close} {...options} {...(overrides ?? {})} />
  ) : null;

  return { open, openWith, close, isOpen, element };
};
