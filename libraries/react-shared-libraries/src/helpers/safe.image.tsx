'use client';

import { FC } from 'react';
import { ImageProps } from 'next/image';

type SafeImageProps = Omit<ImageProps, 'src'> & {
  src: string;
};

const SafeImage: FC<SafeImageProps> = ({
  src,
  alt,
  width,
  height,
  className,
  style,
  onError,
  ...rest
}) => {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- shared wrapper for arbitrary image URLs
    <img
      src={src}
      alt={alt?.toString() || ''}
      width={typeof width === 'number' ? width : undefined}
      height={typeof height === 'number' ? height : undefined}
      className={className}
      style={style}
      onError={onError}
    />
  );
};

export default SafeImage;
