'use client';

import React, { FC, useCallback, useEffect } from 'react';
import { Group, Rect, Line as KonvaLine } from 'react-konva';
import type Konva from 'konva';
import type { DesignerElement } from './designer.store';
import {
  cropDisplayBox,
  type BoxFraction,
  type CropResizeHandle,
} from './crop-geometry';

const HANDLE = 8;

const HANDLES: CropResizeHandle[] = [
  'top-left', 'top', 'top-right',
  'right', 'bottom-right', 'bottom',
  'bottom-left', 'left',
];

interface CropOverlayProps {
  element: DesignerElement;
  natural: { width: number; height: number };
  zoom: number;
  fraction: BoxFraction;
  onDraftChange: (fraction: BoxFraction, handle: CropResizeHandle) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export const CropOverlay: FC<CropOverlayProps> = ({
  element,
  natural,
  zoom,
  fraction,
  onDraftChange,
  onCommit,
  onCancel,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const editing = target?.matches('input, textarea, select, button, [contenteditable="true"]');
      if (e.key === 'Enter' && !editing) {
        e.preventDefault();
        onCommit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCommit, onCancel]);

  const display = cropDisplayBox(element, natural);
  const box = {
    x: display.x + fraction.x * display.width,
    y: display.y + fraction.y * display.height,
    width: fraction.width * display.width,
    height: fraction.height * display.height,
  };

  const handlePos = useCallback((id: CropResizeHandle) => {
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
  }, [box.x, box.y, box.width, box.height]);

  const moveHandle = (id: CropResizeHandle, dxFrac: number, dyFrac: number) => {
    let { x, y, width, height } = fraction;
    if (id.includes('left')) { x += dxFrac; width -= dxFrac; }
    if (id.includes('right')) { width += dxFrac; }
    if (id.includes('top')) { y += dyFrac; height -= dyFrac; }
    if (id.includes('bottom')) { height += dyFrac; }
    onDraftChange({ x, y, width, height }, id);
  };

  const s = 1 / zoom;

  return (
    <Group x={element.x} y={element.y} rotation={element.rotation || 0} listening={true}>
      <Group x={-element.x} y={-element.y}>
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

        <Rect
          x={box.x} y={box.y} width={box.width} height={box.height}
          fill="transparent"
          onDblClick={onCommit}
          onDblTap={onCommit}
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
                  (nx - target.x) / display.width,
                  (ny - target.y) / display.height
                );
                node.position({
                  x: target.x - (HANDLE * s) / 2,
                  y: target.y - (HANDLE * s) / 2,
                });
              }}
            />
          );
        })}
      </Group>
    </Group>
  );
};
