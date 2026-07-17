'use client';

import { useCallback, useEffect, useState } from 'react';

// Document-level fullscreen for the media studios. We deliberately fullscreen
// `document.documentElement` (not a studio container): the modal manager renders
// its overlays at the app root as siblings of the page, so an element-scoped
// fullscreen would hide pickers/dialogs. Whole-document fullscreen keeps them visible.
type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
};
type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement(): Element | null {
  const d = document as FsDocument;
  return d.fullscreenElement || d.webkitFullscreenElement || null;
}

export function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!currentFullscreenElement());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    onChange();
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = useCallback(async () => {
    const d = document as FsDocument;
    try {
      if (currentFullscreenElement()) {
        await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
      } else {
        const el = document.documentElement as FsElement;
        await (el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
      }
    } catch {
      // User dismissed the prompt or the browser blocked it — nothing to do.
    }
  }, []);

  const supported =
    typeof document !== 'undefined' &&
    !!(document.fullscreenEnabled || (document as FsDocument).webkitFullscreenEnabled);

  return { isFullscreen, toggle, supported };
}
