'use client';

import React, { FC, ReactNode, useEffect, useRef, useState } from 'react';

export const DesignPreviewImage: FC<{
  src?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
  draggable?: boolean;
}> = ({ src, alt, className, fallback, draggable }) => {
  const [brokenSource, setBrokenSource] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const image = imageRef.current;
    if (!image || !src) return;
    const onError = () => setBrokenSource(src);
    image.addEventListener('error', onError);
    return () => image.removeEventListener('error', onError);
  }, [src]);

  if (!src || brokenSource === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- stored File or data URL preview
    <img ref={imageRef} src={src} alt={alt} className={className} draggable={draggable} />
  );
};
