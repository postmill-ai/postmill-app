'use client';

import React, { FC } from 'react';
import { Image as KonvaImage } from 'react-konva';
import { computeCoverCrop } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';

interface ExportBackgroundImageProps {
  image: HTMLImageElement;
  width: number;
  height: number;
  focalPoint?: { x: number; y: number };
}

export const ExportBackgroundImage: FC<ExportBackgroundImageProps> = ({
  image,
  width,
  height,
  focalPoint,
}) => (
  <KonvaImage
    image={image}
    x={0}
    y={0}
    width={width}
    height={height}
    crop={computeCoverCrop(
      image.naturalWidth || width,
      image.naturalHeight || height,
      width,
      height,
      focalPoint
    )}
    listening={false}
  />
);
