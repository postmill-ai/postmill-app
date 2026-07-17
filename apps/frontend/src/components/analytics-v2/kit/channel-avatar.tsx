'use client';

import { FC, useState } from 'react';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';

interface ChannelAvatarProps {
  src?: string;
  name?: string;
  /** Provider identifier — used to pick the brand icon fallback. */
  identifier?: string;
  size?: number;
  /** Extra classes for the rounded avatar image. */
  className?: string;
}

// A channel avatar that falls back to the shared brand ProviderIcon when the
// remote picture 404s / fails to load (F10 / 2.9), instead of a broken image.
export const ChannelAvatar: FC<ChannelAvatarProps> = ({
  src,
  name,
  identifier,
  size = 28,
  className,
}) => {
  // Derive failure from the src that actually failed. When `src` changes,
  // `failed` becomes false automatically without an effect.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (!src || failed) {
    return (
      <ProviderIcon identifier={identifier || ''} name={name} size={size} />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailedSrc(src)}
      className={className ?? 'rounded-[8px] object-cover'}
      style={{ width: size, height: size }}
    />
  );
};
