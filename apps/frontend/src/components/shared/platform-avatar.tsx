'use client';

import { FC } from 'react';
import clsx from 'clsx';
import ImageWithFallback from '@gitroom/react/helpers/image.with.fallback';
import SafeImage from '@gitroom/react/helpers/safe.image';

// The channel avatar used across the app (composer channel picker, campaign posts, …):
// the account picture (falling back to a generic avatar) with a platform badge overlay.
export const PlatformAvatar: FC<{
  picture?: string | null;
  identifier?: string | null;
  size?: number;
  selected?: boolean;
  alt?: string;
}> = ({ picture, identifier, size = 42, selected = false, alt }) => {
  return (
    <div
      className={clsx(
        'relative rounded-full flex justify-center items-center bg-newTableHeader filter transition-all duration-500 shrink-0',
        selected ? 'border-[2px] border-[#622FF6]' : 'border-[2px] border-transparent'
      )}
    >
      <ImageWithFallback
        fallbackSrc="/no-picture.jpg"
        src={picture || '/no-picture.jpg'}
        className={clsx(
          'rounded-full transition-all border-[1.5px]',
          selected ? 'border-[#000]' : 'border-transparent'
        )}
        style={{ minWidth: size, minHeight: size, width: size, height: size }}
        alt={alt || identifier || ''}
        width={size}
        height={size}
      />
      {identifier === 'youtube' ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt="YouTube"
          src="/icons/platforms/youtube.svg"
          className="absolute z-10 bottom-0 -end-[5px] min-w-[16px]"
          width={16}
        />
      ) : identifier ? (
        <SafeImage
          src={`/icons/platforms/${identifier}.png`}
          className="rounded-[4px] absolute z-10 bottom-0 -end-[5px] min-w-[16px] min-h-[16px]"
          alt={identifier}
          width={16}
          height={16}
        />
      ) : null}
    </div>
  );
};

export default PlatformAvatar;
