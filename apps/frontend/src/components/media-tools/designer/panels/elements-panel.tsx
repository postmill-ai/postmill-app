'use client';

import React, { FC, useCallback } from 'react';
import type { DesignerElement } from '../designer.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface ElementsPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

interface ShapeOption {
  label: string;
  labelKey: string;
  shape: 'rect' | 'ellipse' | 'line' | 'star';
  icon: string;
}

const shapes: ShapeOption[] = [
  { label: 'Rectangle', labelKey: 'elements_panel_rectangle', shape: 'rect', icon: '▬' },
  { label: 'Ellipse', labelKey: 'elements_panel_ellipse', shape: 'ellipse', icon: '⬮' },
  { label: 'Line', labelKey: 'elements_panel_line', shape: 'line', icon: '╱' },
  { label: 'Star', labelKey: 'elements_panel_star', shape: 'star', icon: '★' },
];

export const ElementsPanel: FC<ElementsPanelProps> = ({ store, onClose }) => {
  const t = useT();
  const addShape = useCallback((shapeOption: ShapeOption) => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];
    const cx = out.width / 2 - 50;
    const cy = out.height / 2 - 50;

    const el: DesignerElement = {
      id: '',
      type: 'shape',
      x: cx,
      y: cy,
      width: 100,
      height: shapeOption.shape === 'line' ? 2 : 100,
      rotation: 0,
      opacity: 1,
      locked: false,
      hidden: false,
      shape: shapeOption.shape,
      fill: shapeOption.shape === 'line' ? undefined : '#2B5CD3',
      stroke: shapeOption.shape === 'line' ? '#2B5CD3' : undefined,
      strokeWidth: shapeOption.shape === 'line' ? 3 : undefined,
    };

    state.addElement(el);
    onClose?.();
  }, [store, onClose]);

  return (
    <div className="grid grid-cols-2 gap-2">
      {shapes.map((shape) => (
        <button
          key={shape.shape}
          onClick={() => addShape(shape)}
          draggable
          onDragStart={(e) =>
            e.dataTransfer.setData(
              'application/x-designer-element',
              JSON.stringify({
                type: 'shape',
                shape: shape.shape,
                width: 100,
                height: shape.shape === 'line' ? 2 : 100,
                fill: shape.shape === 'line' ? undefined : '#2B5CD3',
              })
            )
          }
          className="flex flex-col items-center gap-2 p-4 rounded-lg border border-studioBorder bg-newBgColorInner hover:border-designerAccent hover:bg-studioBorder/10 transition-all"
        >
          <div className="text-[24px] text-btnPrimaryAccent">{shape.icon}</div>
          <div className="text-[11px] text-textColor">{t(shape.labelKey, shape.label)}</div>
        </button>
      ))}
    </div>
  );
};
