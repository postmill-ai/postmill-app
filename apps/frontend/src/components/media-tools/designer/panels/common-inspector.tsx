'use client';

import React, { FC, useState } from 'react';
import { Slider, SegmentedControl, Stepper } from '../controls';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import type { DesignerElement } from '../designer.store';

interface CommonInspectorProps {
  selected: DesignerElement[];
  ids: string[];
  store: any;
}

const ALIGN_CENTER = 'center' as const;

export const CommonInspector: FC<CommonInspectorProps> = ({
  selected,
  ids,
  store,
}) => {
  const t = useT();
  const updateElement = store((s: any) => s.updateElement);
  const updateElements = store((s: any) => s.updateElements);
  const updateElementsSilent = store((s: any) => s.updateElementsSilent);
  const reorder = store((s: any) => s.reorder);
  const pushHistory = store((s: any) => s.pushHistory);
  const currentOutput = store((s: any) => s.currentOutput);
  const doc = store((s: any) => s.doc);

  const output = doc.outputs[currentOutput];
  const primary = selected[0];
  const canvasW = output.width;
  const canvasH = output.height;

  const [aspectLocked, setAspectLocked] = useState(false);
  const aspectRatio =
    primary.naturalWidth && primary.naturalHeight
      ? primary.naturalWidth / primary.naturalHeight
      : primary.width / (primary.height || 1);

  const set = (u: Partial<DesignerElement>) => updateElements(ids, u);

  const handleWidthChange = (n: number) => {
    if (aspectLocked) {
      const h = Math.round(n / aspectRatio);
      updateElements(ids, { width: n, height: h });
    } else {
      updateElements(ids, { width: n });
    }
  };

  const handleHeightChange = (n: number) => {
    if (aspectLocked) {
      const w = Math.round(n * aspectRatio);
      updateElements(ids, { width: w, height: n });
    } else {
      updateElements(ids, { height: n });
    }
  };

  const isMulti = selected.length > 1;

  const alignH = (pos: 'left' | 'center' | 'right') => {
    if (isMulti) {
      const minX = Math.min(...selected.map((s) => s.x));
      const maxX = Math.max(...selected.map((s) => s.x + s.width));
      selected.forEach((el) => {
        let x: number;
        if (pos === 'left') x = minX;
        else if (pos === 'right') x = maxX - el.width;
        else x = Math.round(minX + (maxX - minX) / 2 - el.width / 2);
        updateElement(el.id, { x });
      });
    } else {
      selected.forEach((el) => {
        let x: number;
        if (pos === 'left') x = 0;
        else if (pos === 'right') x = canvasW - el.width;
        else x = Math.round((canvasW - el.width) / 2);
        updateElement(el.id, { x });
      });
    }
    pushHistory();
  };

  const alignV = (pos: 'top' | 'middle' | 'bottom') => {
    if (isMulti) {
      const minY = Math.min(...selected.map((s) => s.y));
      const maxY = Math.max(...selected.map((s) => s.y + s.height));
      selected.forEach((el) => {
        let y: number;
        if (pos === 'top') y = minY;
        else if (pos === 'bottom') y = maxY - el.height;
        else y = Math.round(minY + (maxY - minY) / 2 - el.height / 2);
        updateElement(el.id, { y });
      });
    } else {
      selected.forEach((el) => {
        let y: number;
        if (pos === 'top') y = 0;
        else if (pos === 'bottom') y = canvasH - el.height;
        else y = Math.round((canvasH - el.height) / 2);
        updateElement(el.id, { y });
      });
    }
    pushHistory();
  };

  const distributeHorizontal = () => {
    const sorted = [...selected].sort((a, b) => a.x - b.x);
    const minX = sorted[0].x;
    const maxX = sorted[sorted.length - 1].x + sorted[sorted.length - 1].width;
    const totalWidth = sorted.reduce((sum, s) => sum + s.width, 0);
    const gap = (maxX - minX - totalWidth) / (sorted.length - 1);
    let x = minX;
    for (const s of sorted) {
      updateElement(s.id, { x });
      x += s.width + gap;
    }
    pushHistory();
  };

  const distributeVertical = () => {
    const sorted = [...selected].sort((a, b) => a.y - b.y);
    const minY = sorted[0].y;
    const maxY = sorted[sorted.length - 1].y + sorted[sorted.length - 1].height;
    const totalHeight = sorted.reduce((sum, s) => sum + s.height, 0);
    const gap = (maxY - minY - totalHeight) / (sorted.length - 1);
    let y = minY;
    for (const s of sorted) {
      updateElement(s.id, { y });
      y += s.height + gap;
    }
    pushHistory();
  };

  const resetToOriginal = () => {
    selected.forEach((el) => {
      if (el.naturalWidth && el.naturalHeight) {
        updateElement(el.id, {
          width: el.naturalWidth,
          height: el.naturalHeight,
        });
      }
    });
    pushHistory();
  };

  const hasImageWithNatural = selected.some(
    (el) => el.naturalWidth && el.naturalHeight,
  );

  return (
    <div className="space-y-3 pt-2 border-t border-studioBorder">
      <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
        {t('designer_common', 'Common')}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Stepper
          label={t('designer_label_x', 'X')}
          value={Math.round(primary.x)}
          onChange={(n) => set({ x: n })}
        />
        <Stepper
          label={t('designer_label_y', 'Y')}
          value={Math.round(primary.y)}
          onChange={(n) => set({ y: n })}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-textColor/50">{t('size', 'Size')}</span>
          <button
            onClick={() => setAspectLocked((v) => !v)}
            className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
              aspectLocked
                ? 'bg-designerAccent/20 text-btnPrimaryAccent'
                : 'text-textColor/40 hover:text-textColor'
            }`}
          >
            {aspectLocked ? t('designer_locked', 'Locked') : t('designer_unlocked', 'Unlocked')}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stepper
            label={t('designer_label_w', 'W')}
            min={1}
            value={Math.round(primary.width)}
            onChange={handleWidthChange}
          />
          <Stepper
            label={t('designer_label_h', 'H')}
            min={1}
            value={Math.round(primary.height)}
            onChange={handleHeightChange}
          />
        </div>
      </div>

      <Slider
        label={t('designer_label_rotation', 'Rotation')}
        suffix="°"
        min={0}
        max={360}
        value={Math.round(primary.rotation)}
        onChange={(n) => updateElementsSilent(ids, { rotation: n })}
        onCommit={() => pushHistory()}
      />

      <Slider
        label={t('designer_label_opacity', 'Opacity')}
        suffix="%"
        min={0}
        max={100}
        value={Math.round((primary.opacity ?? 1) * 100)}
        onChange={(n) => updateElementsSilent(ids, { opacity: n / 100 })}
        onCommit={() => pushHistory()}
      />

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-textColor/50">{t('designer_label_lock', 'Lock')}</span>
        <button
          type="button"
          role="switch"
          aria-checked={!!primary.locked}
          onClick={() => set({ locked: !primary.locked })}
          className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
            primary.locked ? 'bg-designerAccent' : 'bg-studioBorder'
          }`}
        >
          <span
            className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
              primary.locked ? 'translate-x-[18px]' : ''
            }`}
          />
        </button>
      </div>

      <div>
        <div className="text-[11px] text-textColor/50 mb-1">{t('designer_label_flip', 'Flip')}</div>
        <SegmentedControl
          value={primary.flipX ? 'h' : primary.flipY ? 'v' : 'none'}
          options={[
            { value: 'none', label: t('gmb_cta_none', 'None') },
            { value: 'h', label: t('designer_flip_h', 'H-Flip') },
            { value: 'v', label: t('designer_flip_v', 'V-Flip') },
          ]}
          onChange={(v) => set({ flipX: v === 'h', flipY: v === 'v' })}
        />
      </div>

      <div>
        <div className="text-[11px] text-textColor/50 mb-1">
          {isMulti ? t('designer_align_to_selection', 'Align to selection') : t('designer_align_to_canvas', 'Align to canvas')}
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => alignV('top')}
            aria-label={isMulti ? t('designer_align_tops', 'Align tops') : t('designer_align_top', 'Align top')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_top', '↑ Top')}
          </button>
          <button
            onClick={() => alignV('middle')}
            aria-label={isMulti ? t('designer_align_vertical_centers', 'Align vertical centers') : t('designer_align_vertical_center', 'Align vertical center')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_middle', '↕ Middle')}
          </button>
          <button
            onClick={() => alignV('bottom')}
            aria-label={isMulti ? t('designer_align_bottoms', 'Align bottoms') : t('designer_align_bottom', 'Align bottom')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_bottom', '↓ Bottom')}
          </button>
        </div>
        <div className="flex gap-1 mt-1">
          <button
            onClick={() => alignH('left')}
            aria-label={isMulti ? t('designer_align_left_edges', 'Align left edges') : t('designer_align_left', 'Align left')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_left', '← Left')}
          </button>
          <button
            onClick={() => alignH(ALIGN_CENTER)}
            aria-label={isMulti ? t('designer_align_horizontal_centers', 'Align horizontal centers') : t('designer_align_horizontal_center', 'Align horizontal center')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_center', '↔ Center')}
          </button>
          <button
            onClick={() => alignH('right')}
            aria-label={isMulti ? t('designer_align_right_edges', 'Align right edges') : t('designer_align_right', 'Align right')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_align_btn_right', '→ Right')}
          </button>
        </div>
        {selected.length >= 3 && (
          <div className="flex gap-1 mt-1">
            <button
              onClick={distributeHorizontal}
              aria-label={t('designer_distribute_horizontally', 'Distribute horizontally')}
              className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
            >
              {t('designer_distribute_btn_h', '↔ H')}
            </button>
            <button
              onClick={distributeVertical}
              aria-label={t('designer_distribute_vertically', 'Distribute vertically')}
              className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
            >
              {t('designer_distribute_btn_v', '↕ V')}
            </button>
          </div>
        )}
      </div>

      <div>
        <div className="text-[11px] text-textColor/50 mb-1">{t('designer_label_layer_order', 'Layer order')}</div>
        <div className="flex gap-1">
          <button
            onClick={() => reorder(ids, 'back')}
            aria-label={t('designer_send_to_back', 'Send to back')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_layer_btn_back', '⤒ Back')}
          </button>
          <button
            onClick={() => reorder(ids, 'backward')}
            aria-label={t('designer_send_backward', 'Send backward')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_layer_btn_bwd', '↓ Bwd')}
          </button>
          <button
            onClick={() => reorder(ids, 'forward')}
            aria-label={t('designer_bring_forward', 'Bring forward')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_layer_btn_fwd', '↑ Fwd')}
          </button>
          <button
            onClick={() => reorder(ids, 'front')}
            aria-label={t('designer_bring_to_front', 'Bring to front')}
            className="flex-1 h-7 rounded text-[11px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
          >
            {t('designer_layer_btn_front', '⤓ Front')}
          </button>
        </div>
      </div>

      {hasImageWithNatural && (
        <button
          onClick={resetToOriginal}
          className="w-full px-3 py-2 rounded-md text-[12px] border border-studioBorder text-textColor hover:bg-studioBorder/30"
        >
          {t('designer_reset_to_original_size', 'Reset to original size')}
        </button>
      )}
    </div>
  );
};
