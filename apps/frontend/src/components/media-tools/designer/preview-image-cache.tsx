'use client';

import React, { FC, useEffect, useRef, useState } from 'react';
import SafeImage from '@postmill-ai/react/helpers/safe.image';
import { Button } from '@postmill-ai/react/form/button';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

export const PreviewImage: FC<{
  imageUrl: string;
  cache: Map<string, Blob>;
  alt: string;
  width: number;
  height: number;
}> = ({ imageUrl, cache, alt, width, height }) => {
  const t = useT();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ src: string; failed: boolean }>(() => {
    const cached = cache.get(imageUrl);
    return { src: cached ? URL.createObjectURL(cached) : '', failed: false };
  });
  const initialSrc = useRef(state.src);

  useEffect(() => {
    if (cache.has(imageUrl)) {
      const cachedSrc = initialSrc.current;
      return () => {
        if (cachedSrc) URL.revokeObjectURL(cachedSrc);
      };
    }

    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    fetch(imageUrl, { credentials: 'include', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Preview image unavailable');
        return response.blob();
      })
      .then((blob) => {
        cache.set(imageUrl, blob);
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setState({ src: objectUrl, failed: false });
        }
      })
      .catch(() => {
        if (active) setState({ src: '', failed: true });
      });

    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [cache, imageUrl, attempt]);

  const retry = () => {
    cache.delete(imageUrl);
    setState({ src: '', failed: false });
    setAttempt((value) => value + 1);
  };

  if (state.failed) {
    return (
      <div className="flex flex-col items-center gap-3">
        <p className="text-[13px] text-newTextColor/60">{t('designer_preview_image_unavailable', 'This preview image is unavailable.')}</p>
        <Button secondary onClick={retry}>{t('retry', 'Retry')}</Button>
      </div>
    );
  }
  if (!state.src) {
    return <p className="text-[13px] text-newTextColor/60">{t('loading_ellipsis', 'Loading…')}</p>;
  }
  return (
    <SafeImage
      src={state.src}
      alt={alt}
      width={width}
      height={height}
      className="max-h-[75vh] max-w-full object-contain"
      onError={() => setState({ src: '', failed: true })}
    />
  );
};
