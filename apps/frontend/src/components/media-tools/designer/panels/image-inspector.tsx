'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { ColorSwatch, Slider, SegmentedControl, Stepper } from '../controls';
import { useBrandColors } from './use-brand-colors';
import { ShadowSection, BackdropSection } from './shadow-section';
import { getImageNaturalSize } from '../elements';
import { smartReflow } from '../reflow';
import type {
  DesignerElement,
  DesignerMask,
} from '../designer.store';
import { useMediaPicker } from '../../use-media-picker';
import { centeredMediaFrame, fitMediaToCanvas } from '../background-removal';
import { cropFromSourceRect } from '../crop-geometry';
import { CutoutRefineControls } from './cutout-refine-controls';
import { QrCodeControls } from './qr-code-controls';
import { trySetPointerCapture } from '../pointer-capture';
import { usePresetPreview } from '../use-preset-preview';
import { replaceStaticImage } from '../image-replacement';
import { InspectorSection, InspectorTabGroup, type InspectorTabKey } from './inspector-tabs';
import { ImageFilterControls } from './image-filter-controls';
import { ImageAiTools } from './image-ai-tools';
import { FocalPointEditor } from './focal-point-editor';

interface ImageInspectorProps {
  element: DesignerElement;
  ids: string[];
  store: any;
  tab?: InspectorTabKey;
}

export const ImageInspector: FC<ImageInspectorProps> = ({
  element,
  ids,
  store,
  tab,
}) => {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const brandColors = useBrandColors();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const updateElement = store((s: any) => s.updateElement);
  const updateElements = store((s: any) => s.updateElements);
  const { preview, cancel } = usePresetPreview(store);

  const [aiLoading, setAiLoading] = useState<string | false>(false);
  const replacePicker = useMediaPicker({
    title: t('replace_image', 'Replace image'),
    kinds: ['image'],
    onSelect: (item) => {
      void replaceStaticImage({ store, elementId: element.id, item }).then((replaced) => {
        if (!replaced) {
          toaster.show(t('designer_image_replace_failed', 'That image replacement could not be applied'), 'warning');
        }
      }).catch(() => {
        toaster.show(t('designer_image_replace_failed', 'That image replacement could not be applied'), 'warning');
      });
    },
  });

  const [draggingFocal, setDraggingFocal] = useState(false);
  const cropChanged = useRef(false);
  const commitCropInset = () => {
    if (!cropChanged.current) return;
    cropChanged.current = false;
    store.getState().pushHistory('Crop image');
  };

  const set = (u: Partial<DesignerElement>) => updateElements(ids, u);
  const previewFrame = (mask: DesignerElement['mask']) => {
    preview(Object.fromEntries(ids.map((id) => [id, { mask }])));
  };
  const applyFrame = (mask: DesignerElement['mask']) => {
    cancel();
    updateElements(ids, { mask });
  };

  const natural = getImageNaturalSize(element.src);

  const cropInset = (side: 'left' | 'top' | 'right' | 'bottom') => {
    if (!element.crop || !natural) return 0;
    const c = element.crop;
    if (side === 'left')
      return Math.round((c.x / natural.width) * 100);
    if (side === 'top')
      return Math.round((c.y / natural.height) * 100);
    if (side === 'right')
      return Math.round((1 - (c.x + c.width) / natural.width) * 100);
    return Math.round((1 - (c.y + c.height) / natural.height) * 100);
  };

  const applyCrop = (
    side: 'left' | 'top' | 'right' | 'bottom',
    pct: number,
  ) => {
    if (!natural) return;
    const cur = element.crop || {
      x: 0,
      y: 0,
      width: natural.width,
      height: natural.height,
    };
    let { x, y, width, height } = cur;
    const f = pct / 100;
    if (side === 'left') {
      const nx = natural.width * f;
      width = width + (x - nx);
      x = nx;
    } else if (side === 'right') {
      width = natural.width * (1 - f) - x;
    } else if (side === 'top') {
      const ny = natural.height * f;
      height = height + (y - ny);
      y = ny;
    } else {
      height = natural.height * (1 - f) - y;
    }
    const accepted = updateElementsSilent(
      [element.id],
      cropFromSourceRect(
        element,
        {
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: Math.max(1, width),
          height: Math.max(1, height),
        },
        undefined,
        side
      )
    );
    cropChanged.current = accepted || cropChanged.current;
  };

  const fitImageToFrame = () => updateElement(element.id, { fitMode: 'contain' });
  const fitImageToCanvas = () => {
    if (!element.naturalWidth || !element.naturalHeight) {
      fitImageToFrame();
      return;
    }
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    updateElement(element.id, {
      ...fitMediaToCanvas(element.naturalWidth, element.naturalHeight, output),
      fitMode: 'contain',
    });
  };
  const centerImage = () => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    updateElement(element.id, centeredMediaFrame(element, output));
  };

  const isSingle = ids.length === 1;

  const resetFormatLayout = () => {
    const state = store.getState();
    const output = state.doc.outputs[state.currentOutput];
    if (!output) return;
    const source = state.doc.outputs[0] ?? output;
    const reflow = smartReflow(element, source, output);
    const updates: Partial<DesignerElement> = {
      ...reflow,
      crop: undefined,
    };
    if (element.type === 'image') {
      updates.fitMode = 'cover';
      updates.focalPoint = { x: 0.5, y: 0.5 };
    }
    updateElement(element.id, updates);
    store.getState().pushHistory();
  };

  return (
    <>
    <div className="space-y-3">
      <InspectorTabGroup for="style" active={tab}>
      <button
        onClick={replacePicker.open}
        className="w-full px-3 py-2 rounded-md text-[12px] border border-designerAccent text-btnPrimaryAccent hover:bg-designerAccent/10 transition-colors"
      >
        {t('designer_replace_image', 'Replace image…')}
      </button>

      {element.qr && (
        <QrCodeControls
          settings={element.qr}
          onApply={(patch) => updateElement(element.id, patch)}
        />
      )}
      </InspectorTabGroup>

      <InspectorTabGroup for="layout" active={tab}>
      <div>
        <div className="text-[11px] text-textColor/50 mb-1">{t('designer_label_fit_mode', 'Fit mode')}</div>
        <SegmentedControl
          value={element.fitMode || 'fill'}
          options={[
            { value: 'contain', label: t('designer_fit_option_fit', 'Fit') },
            { value: 'cover', label: t('designer_fit_option_cover', 'Cover') },
            { value: 'fill', label: t('fill_button', 'Fill') },
          ]}
          onChange={(v) =>
            set({ fitMode: v as 'contain' | 'cover' | 'fill' })
          }
        />
      </div>

      <FocalPointEditor element={element} ids={ids} store={store} />

      <button
        className="w-full px-3 py-2 bg-newBgColor hover:bg-studioBorder/10 text-sm rounded-sm border border-studioBorder text-left"
        onClick={resetFormatLayout}
      >
        {t('designer_reset_format_layout', 'Reset this format’s layout')}
      </button>

      </InspectorTabGroup>

      <InspectorTabGroup for="style" active={tab}>
      <Stepper
        label={t('designer_label_border_radius', 'Border radius')}
        min={0}
        value={
          Array.isArray(element.borderRadius)
            ? element.borderRadius[0]
            : element.borderRadius || 0
        }
        onChange={(n) => set({ borderRadius: n })}
      />

      <div className="space-y-2">
        <div className="text-[11px] text-textColor/50">{t('designer_label_border', 'Border')}</div>
        <ColorSwatch
          label={t('color', 'Color')}
          value={element.stroke || '#000000'}
          onChange={(hex) => set({ stroke: hex })}
          brandColors={brandColors}
          brandEnforcement={brandEnforcement}
        />
        <Stepper
          label={t('designer_label_width', 'Width')}
          min={0}
          max={40}
          value={element.strokeWidth || 0}
          onChange={(n) => set({ strokeWidth: n })}
        />
      </div>

      <BackdropSection element={element} set={set} />

      <ShadowSection
        element={element}
        set={set}
        brandColors={brandColors}
        brandEnforcement={brandEnforcement}
      />

      <ImageFilterControls element={element} ids={ids} store={store} />

      <InspectorSection id="mask" title={t('designer_label_mask_frame', 'Mask / Frame')}>
        <div className="space-y-2">
        <div className="grid grid-cols-3 gap-1.5">
          <button
            type="button"
            title={t('designer_none', 'None')}
            onMouseEnter={() => previewFrame(undefined)}
            onMouseLeave={cancel}
            onClick={() => applyFrame(undefined)}
            className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[20px] transition-all ${
              !element.mask
                ? 'border-designerAccent bg-designerAccent/10 text-btnPrimaryAccent'
                : 'border-studioBorder bg-newBgColorInner text-textColor/60 hover:border-designerAccent hover:text-textColor'
            }`}
          >
            <span className="leading-none">∅</span>
            <span className="text-[9px] leading-none">{t('designer_none', 'None')}</span>
          </button>
          {(
            [
              { shape: 'ellipse', label: t('designer_mask_circle', 'Circle'), icon: '⬮' },
              {
                shape: 'rounded-rect',
                label: t('designer_mask_rounded', 'Rounded'),
                icon: '◻',
              },
              { shape: 'triangle', label: t('designer_mask_triangle', 'Triangle'), icon: '▲' },
              { shape: 'star', label: t('designer_mask_star', 'Star'), icon: '★' },
              {
                shape: 'hexagon',
                label: t('designer_mask_hexagon', 'Hexagon'),
                icon: '⬡',
              },
              { shape: 'heart', label: t('designer_mask_heart', 'Heart'), icon: '♡' },
            ] as const
          ).map(({ shape, label, icon }) => {
            const active =
              element.mask?.type === 'shape' &&
              (element.mask.shape || 'ellipse') === shape;
            return (
              <button
                key={shape}
                type="button"
                title={label}
                onMouseEnter={() => previewFrame({
                  type: 'shape',
                  shape,
                  cornerRadius: shape === 'rounded-rect' ? 8 : undefined,
                })}
                onMouseLeave={cancel}
                onClick={() => applyFrame({
                  type: 'shape',
                  shape,
                  cornerRadius: shape === 'rounded-rect' ? 8 : undefined,
                })}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-[20px] transition-all ${
                  active
                    ? 'border-designerAccent bg-designerAccent/10 text-btnPrimaryAccent'
                    : 'border-studioBorder bg-newBgColorInner text-textColor/60 hover:border-designerAccent hover:text-textColor'
                }`}
              >
                <span className="leading-none">{icon}</span>
                <span className="text-[9px] leading-none">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="image-photo-in-text" className="text-[11px] text-textColor/50">
            {t('designer_label_photo_in_text', 'Photo in text')}
          </label>
          <input
            id="image-photo-in-text"
            type="text"
            value={
              element.mask?.type === 'text' ? element.mask.text || '' : ''
            }
            onChange={(e) => {
              const val = e.target.value;
              if (val.trim()) {
                updateElement(element.id, {
                  mask: { type: 'text', text: val },
                });
              } else if (element.mask?.type === 'text') {
                updateElement(element.id, { mask: undefined });
              } else {
                updateElement(element.id, {
                  mask: { type: 'text', text: '' },
                });
              }
            }}
            placeholder={t('designer_placeholder_photo_in_text', 'Enter text for photo-in-text…')}
            className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-designerAccent"
          />
        </div>

        {element.mask?.type === 'shape' &&
          element.mask.shape === 'rounded-rect' && (
            <Slider
              label={t('designer_label_corner_radius', 'Corner radius')}
              min={0}
              max={Math.min(element.width, element.height) / 2}
              value={element.mask.cornerRadius || 8}
              onChange={(n) =>
                updateElement(element.id, {
                  mask: { ...element.mask!, cornerRadius: n },
                })
              }
            />
          )}

        {element.mask && (
          <button
            onClick={() => applyFrame(undefined)}
            className="w-full px-3 py-2 rounded-md text-[12px] border border-red-400/40 text-dangerText hover:bg-red-400/10 transition-colors"
          >
            {t('designer_remove_frame', 'Remove frame')}
          </button>
        )}
        </div>
      </InspectorSection>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="image-alt-text" className="text-[11px] text-textColor/50">{t('designer_label_alt_text', 'Alt text')}</label>
        <input
          id="image-alt-text"
          type="text"
          value={element.alt || ''}
          onChange={(e) =>
            updateElement(element.id, { alt: e.target.value })
          }
          placeholder={t('designer_placeholder_describe_image', 'Describe this image…')}
          className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-designerAccent"
        />
      </div>
      </InspectorTabGroup>

      <InspectorTabGroup for="layout" active={tab}>
      <div className="grid grid-cols-3 gap-1">
        <button type="button" onClick={fitImageToFrame} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_fit_to_frame', 'Fit to frame')}
        </button>
        <button type="button" onClick={fitImageToCanvas} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_fit_to_canvas', 'Fit to canvas')}
        </button>
        <button type="button" onClick={centerImage} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_center', 'Center')}
        </button>
      </div>

      {isSingle && (
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-textColor/50">{t('designer_label_crop', 'Crop')}</span>
            {element.crop && (
              <button
                className="text-[10px] text-btnPrimaryAccent"
                onClick={() => {
                  updateElement(element.id, { crop: undefined });
                  store.getState().pushHistory('Reset crop');
                }}
              >
                {t('reset', 'Reset')}
              </button>
            )}
          </div>
          {!natural && (
            <div className="text-[10px] text-textColor/30">
              {t('designer_loading_image', 'Loading image…')}
            </div>
          )}
          {natural && (
            <>
              <Slider
                label={t('designer_label_left', 'Left')}
                suffix="%"
                min={0}
                max={45}
                value={cropInset('left')}
                onChange={(n) => applyCrop('left', n)}
                onCommit={commitCropInset}
              />
              <Slider
                label={t('designer_label_right', 'Right')}
                suffix="%"
                min={0}
                max={45}
                value={cropInset('right')}
                onChange={(n) => applyCrop('right', n)}
                onCommit={commitCropInset}
              />
              <Slider
                label={t('designer_label_top', 'Top')}
                suffix="%"
                min={0}
                max={45}
                value={cropInset('top')}
                onChange={(n) => applyCrop('top', n)}
                onCommit={commitCropInset}
              />
              <Slider
                label={t('designer_label_bottom', 'Bottom')}
                suffix="%"
                min={0}
                max={45}
                value={cropInset('bottom')}
                onChange={(n) => applyCrop('bottom', n)}
                onCommit={commitCropInset}
              />
            </>
          )}
        </div>
      )}
      </InspectorTabGroup>

      <div className="grid grid-cols-3 gap-1">
        <button type="button" onClick={fitImageToFrame} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_fit_to_frame', 'Fit to frame')}
        </button>
        <button type="button" onClick={fitImageToCanvas} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_fit_to_canvas', 'Fit to canvas')}
        </button>
        <button type="button" onClick={centerImage} className="px-2 py-1.5 rounded-sm border border-studioBorder text-[11px] text-textColor hover:bg-boxHover">
          {t('designer_center', 'Center')}
        </button>
      </div>

      <InspectorTabGroup for="ai" active={tab}>
        {isSingle && <ImageAiTools key={element.id} element={element} store={store} />}
      </InspectorTabGroup>
    </div>
    <InspectorTabGroup for="ai" active={tab}>
      <CutoutRefineControls store={store} targetId={element.id} />
    </InspectorTabGroup>
    {replacePicker.element}
    </>
  );
};
