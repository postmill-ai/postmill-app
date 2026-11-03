'use client';

import React, { FC, ReactNode, useState } from 'react';

export const DesignPreviewImage: FC<{
  src?: string | null;
  alt: string;
  className: string;
  fallback: ReactNode;
  draggable?: boolean;
}> = ({ src, alt, className, fallback, draggable }) => {
  const [brokenSource, setBrokenSource] = useState<string | null>(null);

  if (!src || brokenSource === src) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- stored File or data URL preview
    <img
      src={src}
      alt={alt}
      className={className}
      draggable={draggable}
      onError={() => setBrokenSource(src)}
    />
  );
};
