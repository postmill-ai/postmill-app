'use client';

import React, { FC } from 'react';
import SafeImage from '@postmill-ai/react/helpers/safe.image';

/**
 * The bare brand mark for a social platform, from `/icons/platforms/`.
 *
 * Use this when you need the *platform's* logo — a format preset, a provider
 * catalog row, a channel-type badge. When you're showing a **connected
 * account**, use `PlatformAvatar` instead: that renders the account's own
 * picture with this mark overlaid as a badge.
 *
 * YouTube is the one asset that ships as SVG rather than PNG; every call site in
 * the app has historically special-cased it, which is the main reason this is
 * worth centralising.
 */
export const PlatformIcon: FC<{
  identifier: string;
  name?: string;
  size?: number;
  className?: string;
  /** Circular crop. Off by default — square marks (e.g. format cards) look wrong cropped. */
  rounded?: boolean;
}> = ({ identifier, name, size = 24, className, rounded = false }) => {
  const src =
    identifier === 'youtube'
      ? '/icons/platforms/youtube.svg'
      : `/icons/platforms/${identifier}.png`;

  return (
    <SafeImage
      className={className ?? (rounded ? 'rounded-full' : undefined)}
      style={{ width: size, height: size }}
      src={src}
      alt={name || identifier}
      // An unmapped identifier would otherwise render a broken-image glyph.
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = 'none';
      }}
    />
  );
};

export default PlatformIcon;
