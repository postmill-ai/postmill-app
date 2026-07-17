'use client';

import React, { FC, useCallback } from 'react';
import type { DesignerElement, VideoClip } from '../designer.store';
import { ensureFontLoaded } from '../fonts';
import { TEXT_STYLE_PRESETS, type TextStylePreset } from '../text-styles';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface TextPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

const CATEGORY_LABELS: Record<TextStylePreset['category'], string> = {
  heading: 'Headings',
  subheading: 'Subheadings',
  body: 'Body',
  caption: 'Captions',
};

const CATEGORY_LABEL_KEYS: Record<TextStylePreset['category'], string> = {
  heading: 'text_panel_headings',
  subheading: 'text_panel_subheadings',
  body: 'text_panel_body',
  caption: 'text_panel_captions',
};

export const TextPanel: FC<TextPanelProps> = ({ store, onClose }) => {
  const translate = useT();
  const addText = useCallback(
    (preset: TextStylePreset) => {
      const state = store.getState();
      const out = state.doc.outputs[state.currentOutput];

      void ensureFontLoaded(preset.fontFamily);

      if (state.doc.mode === 'video') {
        const vo = out as any;
        let textTrack = vo.tracks?.find((t: any) => t.type === 'text');
        if (!textTrack) {
          state.addTrack(state.currentOutput, 'text');
          textTrack = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'text');
        }
        if (!textTrack) return;
        const durationMs = vo.durationMs || 10000;
        const startMs = Math.min(state.playheadMs, durationMs - 1000);
        const clip: VideoClip = {
          id: '',
          startMs,
          endMs: Math.min(startMs + 4000, durationMs),
          text: preset.name,
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontWeight: preset.fontWeight,
          fill: preset.fill || '#000000',
          x: (out.width - 200) / 2,
          y: (out.height - 40) / 2,
          width: 200,
          height: 40,
          opacity: 1,
        };
        store.getState().addClip(state.currentOutput, textTrack.id, clip);
        onClose?.();
        return;
      }

      const cx = out.width / 2 - 100;
      const cy = out.height / 2 - 16;

      const el: DesignerElement = {
        id: '',
        type: 'text',
        x: cx,
        y: cy,
        width: 200,
        height: 40,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        text: preset.name,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        fontFamily: preset.fontFamily,
        fill: preset.fill || '#000000',
        align: 'center',
        lineHeight: preset.lineHeight,
        letterSpacing: preset.letterSpacing,
      };

      state.addElement(el);
      onClose?.();
    },
    [store, onClose]
  );

  const categories: TextStylePreset['category'][] = ['heading', 'subheading', 'body', 'caption'];

  return (
    <div className="flex flex-col gap-4">
      {categories.map((category) => {
        const presets = TEXT_STYLE_PRESETS.filter((p) => p.category === category);
        if (!presets.length) return null;
        return (
          <div key={category} className="flex flex-col gap-2">
            <div className="text-[11px] text-newTextColor/60 uppercase tracking-wider">
              {translate(CATEGORY_LABEL_KEYS[category], CATEGORY_LABELS[category])}
            </div>
            <div className="flex flex-col gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.name}
                  onClick={() => addText(preset)}
                  draggable
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      'application/x-designer-element',
                      JSON.stringify({
                        type: 'text',
                        text: preset.name,
                        fontSize: preset.fontSize,
                        fontWeight: preset.fontWeight,
                        fontFamily: preset.fontFamily,
                        width: 200,
                        height: 40,
                        fill: preset.fill || '#000000',
                        align: 'center',
                        lineHeight: preset.lineHeight,
                        letterSpacing: preset.letterSpacing,
                      })
                    )
                  }
                  className="w-full rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-left hover:border-designerAccent hover:bg-studioBorder/10 transition-all group"
                >
                  <div
                    className="text-textColor"
                    style={{
                      fontSize: `${Math.min(preset.fontSize, 20)}px`,
                      fontWeight: preset.fontWeight,
                      fontFamily: `"${preset.fontFamily}"`,
                      lineHeight: preset.lineHeight,
                      letterSpacing: `${preset.letterSpacing}px`,
                      color: preset.fill || undefined,
                    }}
                  >
                    {preset.name}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
