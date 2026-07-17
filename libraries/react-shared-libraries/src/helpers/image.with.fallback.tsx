'use client';

import { FC, useState } from 'react';
import SafeImage from './safe.image';
interface ImageSrc {
  src: string;
  fallbackSrc: string;
  width: number;
  height: number;
  [key: string]: any;
}
const InnerImageWithFallback: FC<ImageSrc> = (props) => {
  const { src, fallbackSrc, ...rest } = props;
  const [imgSrc, setImgSrc] = useState(src);
  return (
    <SafeImage
      alt=""
      {...rest}
      src={imgSrc}
      onError={() => {
        setImgSrc(fallbackSrc);
      }}
    />
  );
};
const ImageWithFallback: FC<ImageSrc> = (props) => {
  // Remount the inner component whenever the source changes so the fallback
  // state resets without an effect-derived setState.
  return <InnerImageWithFallback key={props.src} {...props} />;
};
export default ImageWithFallback;
