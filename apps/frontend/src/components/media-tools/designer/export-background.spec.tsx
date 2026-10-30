import { afterEach, describe, expect, it } from 'vitest';
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Konva from 'konva';
import { Layer, Stage } from 'react-konva';
import { ExportBackgroundImage } from './export-background';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

const sourceImage = async (): Promise<HTMLImageElement> => {
  const source = document.createElement('canvas');
  source.width = 8;
  source.height = 2;
  const ctx = source.getContext('2d')!;
  ctx.fillStyle = '#ff0000';
  ctx.fillRect(0, 0, 4, 1);
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 1, 4, 1);
  ctx.fillStyle = '#0000ff';
  ctx.fillRect(4, 0, 4, 1);
  ctx.fillStyle = '#ffff00';
  ctx.fillRect(4, 1, 4, 1);

  Object.defineProperties(source, {
    naturalWidth: { value: 8 },
    naturalHeight: { value: 2 },
  });
  return source as unknown as HTMLImageElement;
};

const pixel = (stage: Konva.Stage, x: number, y: number): number[] => {
  const data = stage.toCanvas().getContext('2d')!.getImageData(x, y, 1, 1).data;
  return [...data];
};

describe('ExportBackgroundImage', () => {
  it('paints the focal cover window, not a stretched full source', async () => {
    const image = await sourceImage();
    const stageRef = React.createRef<Konva.Stage>();
    const host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(
        <Stage ref={stageRef} width={100} height={100} pixelRatio={1}>
          <Layer>
            <ExportBackgroundImage
              image={image}
              width={100}
              height={100}
              focalPoint={{ x: 0.75, y: 0.5 }}
            />
          </Layer>
        </Stage>
      );
    });
    const stage = stageRef.current!;
    stage.draw();

    const node = stage.findOne('Image') as Konva.Image;
    expect(node.crop()).toEqual({ x: 4.5, y: 0, width: 2, height: 2 });
    const top = pixel(stage, 50, 25);
    const bottom = pixel(stage, 50, 75);
    expect(top[0]).toBeLessThan(3);
    expect(top[1]).toBeLessThan(3);
    expect(top[2]).toBeGreaterThan(252);
    expect(top[3]).toBe(255);
    expect(bottom[0]).toBeGreaterThan(252);
    expect(bottom[1]).toBeGreaterThan(252);
    expect(bottom[2]).toBeLessThan(3);
    expect(bottom[3]).toBe(255);
  });
});
