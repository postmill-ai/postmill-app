'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import { Group, Rect, Line as KonvaLine } from 'react-konva';
import type Konva from 'konva';
import type { DesignerElement } from './designer.store';
import {
  cropFromBoxFraction,
  constrainFractionToRatio,
  normaliseFraction,
  parseCropRatio,
  type BoxFraction,
} from './crop-geometry';

/**
 * On-canvas crop overlay for the Crop tool.
 *
 * The Designer had crop DATA (`DesignerCrop`) and inspector sliders but no
 * direct manipulation — this is the missing handle-drag UI. It renders inside
 * the Konva stage in document coordinates, so it lines up with the element at
 * any zoom.
 *
 * Enter or a double-click commits; Escape cancels. Committing composes the new
 * crop onto any existing one (see `crop-geometry`).
 */

const HANDLE = 8;
const FULL: BoxFraction = { x: 0, y: 0, width: 1, height: 1 };

type HandleId =
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  | 'top' | 'bottom' | 'left' | 'right';

const HANDLES: HandleId[] = [
  'top-left', 'top', 'top-right',
  'right', 'bottom-right', 'bottom',
  'bottom-left', 'left',
];

interface CropOverlayProps {
  element: DesignerElement;
  natural: { width: number; height: number } | null;
  zoom: number;
  /** Aspect ratio string from the options bar (`free`, `1:1`, `16:9`, …). */
  ratio?: string;
  onCommit: (patch: Partial<DesignerElement>) => void;
  onCancel: () => void;
}

export const CropOverlay: FC<CropOverlayProps> = ({
  element,
  natural,
  zoom,
  ratio,
  onCommit,
  onCancel,
}) => {
  // Starts at the full box every mount. The caller keys this component by
  // element id, so targeting a different element remounts it and the crop
  // resets — no reset-in-effect needed.
  const [frac, setFrac] = useState<BoxFraction>(FULL);
  const ratioValue = parseCropRatio(ratio);

  const commit = useCallback(() => {
    const f = normaliseFraction(frac);
    // A full-box crop is a no-op; don't dirty the document for nothing.
    if (f.x === 0 && f.y === 0 && f.width === 1 && f.height === 1) {
      onCancel();
      return;
    }
    onCommit(cropFromBoxFraction(element, natural, f));
  }, [frac, element, natural, onCommit, onCancel]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, onCancel]);

  const box = {
    x: element.x + frac.x * element.width,
    y: element.y + frac.y * element.height,
    width: frac.width * element.width,
    height: frac.height * element.height,
  };

  const moveHandle = (id: HandleId, dxFrac: number, dyFrac: number) => {
    setFrac((prev) => {
      let { x, y, width, height } = prev;
      if (id.includes('left')) { x += dxFrac; width -= dxFrac; }
      if (id.includes('right')) { width += dxFrac; }
      if (id.includes('top')) { y += dyFrac; height -= dyFrac; }
      if (id.includes('bottom')) { height += dyFrac; }
      if (id === 'left') { x += dxFrac; width -= dxFrac; }
      if (id === 'right') { width += dxFrac; }
      if (id === 'top') { y += dyFrac; height -= dyFrac; }
      if (id === 'bottom') { height += dyFrac; }
      const next = normaliseFraction({ x, y, width, height });
      return constrainFractionToRatio(next, ratioValue, element.width, element.height);
    });
  };

  const handlePos = (id: HandleId) => {
    const midX = box.x + box.width / 2;
    const midY = box.y + box.height / 2;
    const left = box.x;
    const right = box.x + box.width;
    const top = box.y;
    const bottom = box.y + box.height;
    switch (id) {
      case 'top-left': return { x: left, y: top };
      case 'top': return { x: midX, y: top };
      case 'top-right': return { x: right, y: top };
      case 'right': return { x: right, y: midY };
      case 'bottom-right': return { x: right, y: bottom };
      case 'bottom': return { x: midX, y: bottom };
      case 'bottom-left': return { x: left, y: bottom };
      case 'left': return { x: left, y: midY };
    }
  };

  const s = 1 / zoom; // keep chrome a constant on-screen size at any zoom

  return (
    <Group listening={true}>
      {/* Dim everything outside the crop box, in four bands. */}
      <Rect x={element.x} y={element.y} width={element.width} height={box.y - element.y}
        fill="rgba(0,0,0,0.5)" listening={false} />
      <Rect x={element.x} y={box.y + box.height} width={element.width}
        height={element.y + element.height - (box.y + box.height)}
        fill="rgba(0,0,0,0.5)" listening={false} />
      <Rect x={element.x} y={box.y} width={box.x - element.x} height={box.height}
        fill="rgba(0,0,0,0.5)" listening={false} />
      <Rect x={box.x + box.width} y={box.y}
        width={element.x + element.width - (box.x + box.width)} height={box.height}
        fill="rgba(0,0,0,0.5)" listening={false} />

      <Rect
        x={box.x} y={box.y} width={box.width} height={box.height}
        stroke="#ffffff" strokeWidth={1.5 * s} listening={false}
      />

      {/* Rule-of-thirds guides. */}
      {[1, 2].map((i) => (
        <KonvaLine key={`v${i}`} listening={false}
          points={[box.x + (box.width * i) / 3, box.y, box.x + (box.width * i) / 3, box.y + box.height]}
          stroke="rgba(255,255,255,0.45)" strokeWidth={1 * s} />
      ))}
      {[1, 2].map((i) => (
        <KonvaLine key={`h${i}`} listening={false}
          points={[box.x, box.y + (box.height * i) / 3, box.x + box.width, box.y + (box.height * i) / 3]}
          stroke="rgba(255,255,255,0.45)" strokeWidth={1 * s} />
      ))}

      {/* Double-click anywhere inside to commit, matching Photoshop. */}
      <Rect
        x={box.x} y={box.y} width={box.width} height={box.height}
        fill="transparent"
        onDblClick={commit}
        onDblTap={commit}
      />

      {HANDLES.map((id) => {
        const p = handlePos(id);
        return (
          <Rect
            key={id}
            x={p.x - (HANDLE * s) / 2}
            y={p.y - (HANDLE * s) / 2}
            width={HANDLE * s}
            height={HANDLE * s}
            fill="#ffffff"
            stroke="#2B5CD3"
            strokeWidth={1 * s}
            draggable={true}
            onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
              const node = e.target;
              const nx = node.x() + (HANDLE * s) / 2;
              const ny = node.y() + (HANDLE * s) / 2;
              const target = handlePos(id);
              moveHandle(
                id,
                (nx - target.x) / element.width,
                (ny - target.y) / element.height
              );
              // The overlay re-renders from state, so snap the node back and let
              // the derived position win — otherwise it drifts from the box.
              node.position({
                x: target.x - (HANDLE * s) / 2,
                y: target.y - (HANDLE * s) / 2,
              });
            }}
          />
        );
      })}
    </Group>
  );
};
