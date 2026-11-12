'use client';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Layer, Rect, Stage } from 'react-konva';
import type Konva from 'konva';
import type {
  DesignerOutput,
  SymbolDefinition,
} from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.schema';
import { CanvasElements, gradientFillProps } from './elements';
import { ExportBackgroundImage } from './export-background';
import { getThumbnailDataUrl } from './stage-thumbnail';
import { textureFillProps } from './textures';

const preloadImages = (output: DesignerOutput): Promise<void> => {
  const srcs = new Set<string>();
  if (output.bg?.type === 'image' && output.bg.src) srcs.add(output.bg.src);
  output.children.forEach((element) => {
    if (element.type === 'image' && element.src) srcs.add(element.src);
  });
  if (!srcs.size) return Promise.resolve();
  return Promise.all(
    Array.from(srcs).map(
      (src) =>
        new Promise<void>((resolve) => {
          const image = new Image();
          image.crossOrigin = 'anonymous';
          image.onload = () => resolve();
          image.onerror = () => resolve();
          image.src = src;
        })
    )
  ).then(() => undefined);
};

export const renderOutputThumbnail = async (
  output: DesignerOutput,
  symbols?: SymbolDefinition[],
  maxDim = 300
): Promise<string | undefined> => {
  await preloadImages(output);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  const root = createRoot(host);
  const stageRef = React.createRef<Konva.Stage>();
  const stageScale = Math.min(1, maxDim / Math.max(output.width, output.height));
  const stageWidth = Math.max(1, Math.round(output.width * stageScale));
  const stageHeight = Math.max(1, Math.round(output.height * stageScale));
  const bg = output.bg;
  const bgGrad =
    bg?.type === 'gradient' ? gradientFillProps(bg.gradient, output.width, output.height) : {};
  const solidBg =
    bg?.type === 'gradient' ? undefined : bg?.color || output.background || '#ffffff';
  const bgImageSrc = bg?.type === 'image' ? bg.src : undefined;
  const bgImageEl = (() => {
    if (!bgImageSrc) return null;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.src = bgImageSrc;
    return image;
  })();
  const bgTexture = bg?.texture ? textureFillProps(bg.texture) : null;
  if (bgImageEl && !bgImageEl.complete) {
    await new Promise<void>((resolve) => {
      const done = () => resolve();
      bgImageEl.addEventListener('load', done, { once: true });
      bgImageEl.addEventListener('error', done, { once: true });
      setTimeout(done, 5000);
    });
  }

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <Stage
          ref={stageRef}
          width={stageWidth}
          height={stageHeight}
          scaleX={stageWidth / output.width}
          scaleY={stageHeight / output.height}
          pixelRatio={1}
        >
          <Layer>
            <Rect
              x={0}
              y={0}
              width={output.width}
              height={output.height}
              fill={solidBg}
              {...bgGrad}
            />
            {bg?.type === 'image' && bgImageEl && (
              <ExportBackgroundImage
                image={bgImageEl}
                width={output.width}
                height={output.height}
                focalPoint={bg.focalPoint}
              />
            )}
            {bgTexture && (
              <Rect
                x={0}
                y={0}
                width={output.width}
                height={output.height}
                {...bgTexture}
                listening={false}
              />
            )}
            <CanvasElements elements={output.children} symbols={symbols} onSelect={() => {}} />
          </Layer>
        </Stage>
      );
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const stage = stageRef.current;
    if (!stage) return undefined;
    stage.draw();
    return getThumbnailDataUrl(stage.toCanvas(), maxDim);
  } finally {
    root.unmount();
    host.remove();
  }
};
