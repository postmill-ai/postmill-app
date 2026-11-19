'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const usePreviewImage = (imageUrl: string) => {
  const cache = useRef(new Map<string, Blob>());
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ src: string; failed: boolean }>({ src: '', failed: false });

  useEffect(() => {
    if (!imageUrl) {
      setState({ src: '', failed: false });
      return;
    }
    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    setState({ src: '', failed: false });

    const show = (blob: Blob) => {
      objectUrl = URL.createObjectURL(blob);
      if (active) setState({ src: objectUrl, failed: false });
    };
    const cached = cache.current.get(imageUrl);
    if (cached) {
      show(cached);
    } else {
      fetch(imageUrl, { credentials: 'include', signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error('Preview image unavailable');
          return response.blob();
        })
        .then((blob) => {
          cache.current.set(imageUrl, blob);
          if (active) show(blob);
        })
        .catch(() => {
          if (active) setState({ src: '', failed: true });
        });
    }

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [imageUrl, attempt]);

  const retry = useCallback(() => {
    cache.current.delete(imageUrl);
    setAttempt((value) => value + 1);
  }, [imageUrl]);
  const fail = useCallback(() => setState({ src: '', failed: true }), []);

  return { src: state.src, failed: state.failed, retry, fail };
};
