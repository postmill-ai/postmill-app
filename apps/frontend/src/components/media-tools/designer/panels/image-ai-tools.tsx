'use client';

/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- custom pointer-driven mask painting surface */

import React, { FC, useCallback, useRef, useState } from 'react';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useMediaToolsStatus } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { Slider } from '../controls';
import type { DesignerElement } from '../designer.store';
import {
  aiImageToImage,
  aiInpaint,
  aiRemoveBackground,
  aiUpscale,
  applyAiRemoveBackground,
} from '../ai-image-actions';
import { OutpaintDialog, type OutpaintRequest } from '../outpaint-dialog';
import { applyAiOutpaint, applyWholePageOutpaint, cleanupOutpaintCandidate, prepareAiOutpaint, prepareWholePageOutpaint } from '../outpaint';
import { BackgroundRemovalDialog } from '../background-removal-dialog';
import { prepareStaticMagicGrab, applyStaticMagicGrab } from '../magic-grab';
import { openMagicGrabReview } from '../magic-grab-modal';
import { trySetPointerCapture } from '../pointer-capture';
import { AiGenerateButton, AiToolCard } from './ai-tool-card';

interface ImageAiToolsProps {
  element: DesignerElement;
  store: any;
}

export const ImageAiTools: FC<ImageAiToolsProps> = ({ element, store }) => {
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const modals = useModals();
  const { operationAvailable } = useMediaToolsStatus();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<string | false>(false);
  const [upscaleScale, setUpscaleScale] = useState(2);
  const [inpaintPrompt, setInpaintPrompt] = useState('');
  const [imageToImagePrompt, setImageToImagePrompt] = useState('');
  const [inpaintMaskUrl, setInpaintMaskUrl] = useState<string | null>(null);
  const [masking, setMasking] = useState(false);
  const [brushSize, setBrushSize] = useState(14);
  const [isDrawingMask, setIsDrawingMask] = useState(false);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewImgRef = useRef<HTMLImageElement | null>(null);

  const toggle = (id: string) => setExpanded((current) => current === id ? null : id);
  const outdated = () => toaster.show(
    t('designer_bg_result_outdated', 'The design changed while this result was being prepared. Please generate it again.'),
    'warning'
  );

  const handleRemoveBackground = async () => {
    if (!element.src) return;
    setAiLoading('remove-bg');
    try {
      const candidate = await aiRemoveBackground({ fetch, store, elementId: element.id });
      if (!candidate) {
        outdated();
        return;
      }
      modals.openModal({
        title: t('designer_review_background_removal', 'Review background removal'),
        size: 720,
        children: (close: () => void) => (
          <BackgroundRemovalDialog
            originalUrl={candidate.before.src!}
            asset={candidate.asset}
            onCancel={close}
            onApply={async (fit) => {
              const state = store.getState();
              const output = state.doc.outputs[state.currentOutput];
              const applied = await applyAiRemoveBackground({ store, candidate, output, fit, fetch });
              if (applied) close();
              else throw new Error(t('designer_bg_result_outdated', 'The design changed while this result was being prepared. Please generate it again.'));
            }}
          />
        ),
      });
    } catch (err) {
      toaster.show((err as Error)?.message || t('designer_bg_removal_failed', 'Background removal failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  const handleMagicGrab = async () => {
    if (!element.src) return;
    setAiLoading('magic-grab');
    try {
      const candidate = await prepareStaticMagicGrab({ fetch, store, elementId: element.id });
      if (!candidate) {
        toaster.show(t('designer_magic_grab_outdated', 'The design changed before this result could be applied. Please try again.'), 'warning');
        return;
      }
      openMagicGrabReview({
        modals,
        title: t('designer_magic_grab_title', 'Magic Grab / Select Subject'),
        fetch,
        candidate,
        onApply: () => applyStaticMagicGrab({
          fetch,
          store,
          candidate,
          subjectName: t('designer_magic_grab_subject', 'Movable subject'),
        }),
      });
    } catch (err) {
      toaster.show((err as Error)?.message || t('designer_magic_grab_failed', 'Magic Grab failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  const handleUpscale = async () => {
    setAiLoading('upscale');
    try {
      if (!await aiUpscale({ fetch, store, elementId: element.id }, upscaleScale)) outdated();
    } catch (err) {
      toaster.show((err as Error)?.message || t('designer_upscale_failed', 'Upscale failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  const handleInpaint = async () => {
    if (!inpaintPrompt.trim() || !inpaintMaskUrl) return;
    setAiLoading('inpaint');
    try {
      if (!await aiInpaint(
        { fetch, store, elementId: element.id },
        { maskUrl: inpaintMaskUrl, prompt: inpaintPrompt.trim() }
      )) outdated();
    } catch (err) {
      toaster.show((err as Error)?.message || t('designer_inpaint_failed', 'Inpaint failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  const handleImageToImage = async () => {
    if (!imageToImagePrompt.trim()) return;
    setAiLoading('image-to-image');
    try {
      if (!await aiImageToImage(
        { fetch, store, elementId: element.id },
        imageToImagePrompt.trim()
      )) outdated();
    } catch (err) {
      toaster.show((err as Error)?.message || t('designer_image_to_image_failed', 'Image-to-image failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  const handleOutpaint = () => {
    if (!element.src) return;
    modals.openModal({
      id: `image-outpaint-${element.id}`,
      title: t('designer_expand_image_ai', 'Expand Image (AI)'),
      children: (close: () => void) => (
        <OutpaintDialog
          pageWidth={store.getState().doc.outputs[store.getState().currentOutput].width}
          pageHeight={store.getState().doc.outputs[store.getState().currentOutput].height}
          onCancel={close}
          onPrepare={(request: OutpaintRequest) => request.scope === 'page'
            ? prepareWholePageOutpaint({
                fetch,
                store,
                elementId: element.id,
                targetWidth: request.targetWidth!,
                targetHeight: request.targetHeight!,
                prompt: request.prompt,
              })
            : prepareAiOutpaint({
                fetch,
                store,
                elementId: element.id,
                mode: request.mode!,
                prompt: request.prompt,
              })}
          onApply={async (candidate) => candidate.kind === 'page'
            ? applyWholePageOutpaint({ store, candidate })
            : applyAiOutpaint({ store, candidate })}
          onDiscard={(candidate) => cleanupOutpaintCandidate(fetch, candidate)}
        />
      ),
    });
  };

  const initMaskCanvases = useCallback(() => {
    const img = previewImgRef.current;
    if (!img) return;
    const width = Math.max(1, img.clientWidth);
    const height = Math.max(1, img.clientHeight);
    if (!maskCanvasRef.current) maskCanvasRef.current = document.createElement('canvas');
    maskCanvasRef.current.width = width;
    maskCanvasRef.current.height = height;
    const maskContext = maskCanvasRef.current.getContext('2d');
    if (maskContext) {
      maskContext.fillStyle = '#000000';
      maskContext.fillRect(0, 0, width, height);
    }
    const overlay = overlayCanvasRef.current;
    if (overlay) {
      overlay.width = width;
      overlay.height = height;
      overlay.getContext('2d')?.clearRect(0, 0, width, height);
    }
  }, []);

  const clearMask = useCallback(() => {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;
    const maskContext = mask.getContext('2d');
    if (maskContext) {
      maskContext.fillStyle = '#000000';
      maskContext.fillRect(0, 0, mask.width, mask.height);
    }
    overlay.getContext('2d')?.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const drawMaskStroke = useCallback((x: number, y: number) => {
    const mask = maskCanvasRef.current;
    const overlay = overlayCanvasRef.current;
    if (!mask || !overlay) return;
    const maskContext = mask.getContext('2d');
    if (!maskContext) return;
    maskContext.beginPath();
    maskContext.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    maskContext.fillStyle = '#ffffff';
    maskContext.fill();

    const overlayContext = overlay.getContext('2d');
    if (!overlayContext) return;
    overlayContext.clearRect(0, 0, overlay.width, overlay.height);
    overlayContext.drawImage(mask, 0, 0);
    overlayContext.globalCompositeOperation = 'source-in';
    overlayContext.fillStyle = 'rgba(255, 0, 0, 0.55)';
    overlayContext.fillRect(0, 0, overlay.width, overlay.height);
    overlayContext.globalCompositeOperation = 'source-over';
  }, [brushSize]);

  const getMaskPos = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const uploadMask = async () => {
    const mask = maskCanvasRef.current;
    if (!mask) return;
    setAiLoading('mask-upload');
    try {
      const blob = await new Promise<Blob | null>((resolve) => mask.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Mask empty');
      const formData = new FormData();
      formData.append('file', blob, `mask-${Date.now()}.png`);
      formData.append('internal', 'design-asset');
      const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      const url = data.path || data.url;
      if (!url) throw new Error('No mask URL');
      setInpaintMaskUrl(url);
      setMasking(false);
    } catch {
      toaster.show(t('designer_mask_upload_failed', 'Mask upload failed'), 'warning');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="pt-3 border-t border-studioBorder">
      <h4 className="text-xs font-semibold text-newTableText mb-2 uppercase tracking-wider">{t('designer_ai_tools', 'AI Tools')}</h4>
      <div className="space-y-2">
        {operationAvailable('bg-remove') && (
          <AiToolCard
            id="remove-background"
            title={t('designer_remove_background', 'Remove Background')}
            description={t('designer_ai_remove_bg_desc', 'Create a transparent cutout and review it before applying.')}
            expanded={expanded === 'remove-bg'}
            onToggle={() => toggle('remove-bg')}
          >
            <AiGenerateButton busy={aiLoading === 'remove-bg'} disabled={!!aiLoading || !element.src} onClick={handleRemoveBackground} />
          </AiToolCard>
        )}

        {operationAvailable('bg-remove') && operationAvailable('inpaint') && (
          <AiToolCard
            id="magic-grab"
            title={t('designer_magic_grab', 'Magic Grab / Select Subject')}
            description={t('designer_ai_magic_grab_desc', 'Separate the main subject into a movable layer and reconstruct its background.')}
            expanded={expanded === 'magic-grab'}
            onToggle={() => toggle('magic-grab')}
          >
            <AiGenerateButton busy={aiLoading === 'magic-grab'} disabled={!!aiLoading || !element.src} onClick={handleMagicGrab} />
          </AiToolCard>
        )}

        {operationAvailable('upscale') && (
          <AiToolCard
            id="upscale"
            title={t('designer_upscale', 'Upscale')}
            description={t('designer_ai_upscale_desc', 'Increase the selected image resolution by 2× or 4×.')}
            expanded={expanded === 'upscale'}
            onToggle={() => toggle('upscale')}
          >
            <label className="text-[11px] text-textColor/60" htmlFor="image-upscale-scale">{t('designer_upscale', 'Upscale')}</label>
            <select
              id="image-upscale-scale"
              className="w-full px-2 py-1.5 bg-newBgColor border border-studioBorder rounded-sm text-sm text-textColor"
              value={upscaleScale}
              onChange={(event) => setUpscaleScale(Number(event.target.value))}
            >
              <option value={2}>{t('designer_upscale_2x', '2× Upscale')}</option>
              <option value={4}>{t('designer_upscale_4x', '4× Upscale')}</option>
            </select>
            <AiGenerateButton busy={aiLoading === 'upscale'} disabled={!!aiLoading || !element.src} onClick={handleUpscale} />
          </AiToolCard>
        )}

        {operationAvailable('image') && (
          <AiToolCard
            id="image-to-image"
            title={t('designer_image_to_image', 'Image to Image')}
            description={t('designer_ai_image_to_image_desc', 'Transform the selected image with a prompt while using it as the source.')}
            expanded={expanded === 'image-to-image'}
            onToggle={() => toggle('image-to-image')}
          >
            <input
              aria-label={t('designer_image_to_image', 'Image to Image')}
              className="w-full px-2 py-1.5 bg-newBgColor border border-studioBorder rounded-sm text-sm text-textColor"
              placeholder={t('designer_placeholder_image_to_image', 'Image-to-image prompt...')}
              value={imageToImagePrompt}
              onChange={(event) => setImageToImagePrompt(event.target.value)}
            />
            <AiGenerateButton
              busy={aiLoading === 'image-to-image'}
              disabled={!!aiLoading || !element.src || !imageToImagePrompt.trim()}
              onClick={handleImageToImage}
            />
          </AiToolCard>
        )}

        {operationAvailable('inpaint') && (
          <AiToolCard
            id="inpaint"
            title={t('designer_inpaint', 'Inpaint')}
            description={t('designer_ai_inpaint_desc', 'Paint a mask and describe what should replace the masked area.')}
            expanded={expanded === 'inpaint'}
            onToggle={() => toggle('inpaint')}
          >
            <input
              aria-label={t('designer_inpaint', 'Inpaint')}
              className="w-full px-2 py-1.5 bg-newBgColor border border-studioBorder rounded-sm text-sm text-textColor"
              placeholder={t('designer_placeholder_inpaint', 'Inpaint prompt...')}
              value={inpaintPrompt}
              onChange={(event) => setInpaintPrompt(event.target.value)}
            />

            {masking && (
              <div className="flex flex-col gap-2">
                <div
                  role="application"
                  aria-label={t('designer_draw_mask', 'Draw mask…')}
                  tabIndex={0}
                  className="relative w-full rounded-sm overflow-hidden border border-studioBorder cursor-crosshair"
                  onPointerDown={(event) => {
                    trySetPointerCapture(event.currentTarget, event.pointerId);
                    setIsDrawingMask(true);
                    const point = getMaskPos(event);
                    drawMaskStroke(point.x, point.y);
                  }}
                  onPointerMove={(event) => {
                    if (!isDrawingMask) return;
                    const point = getMaskPos(event);
                    drawMaskStroke(point.x, point.y);
                  }}
                  onPointerUp={() => setIsDrawingMask(false)}
                  onPointerLeave={() => setIsDrawingMask(false)}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                  <img
                    ref={previewImgRef}
                    src={element.src}
                    alt=""
                    className="w-full h-auto block"
                    onLoad={initMaskCanvases}
                  />
                  <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
                </div>
                <Slider label={t('designer_label_brush', 'Brush')} suffix="px" min={4} max={48} step={2} value={brushSize} onChange={setBrushSize} />
                <div className="flex gap-2">
                  <button className="flex-1 px-2 py-1.5 bg-newBgColor hover:bg-studioBorder/10 text-xs rounded-sm border border-studioBorder" onClick={clearMask}>
                    {t('clear', 'Clear')}
                  </button>
                  <button className="flex-1 px-2 py-1.5 bg-designerAccent/10 hover:bg-designerAccent/20 text-xs rounded-sm border border-designerAccent/30" onClick={uploadMask} disabled={!!aiLoading}>
                    {aiLoading === 'mask-upload' ? t('designer_uploading_ellipsis_dots', 'Uploading…') : t('done', 'Done')}
                  </button>
                </div>
              </div>
            )}

            {!masking && (
              <button
                className="w-full px-3 py-1.5 bg-newBgColor hover:bg-studioBorder/10 text-sm rounded-sm border border-studioBorder text-start"
                onClick={() => setMasking(true)}
                disabled={!!aiLoading}
              >
                {inpaintMaskUrl ? t('designer_edit_mask', 'Edit mask') : t('designer_draw_mask', 'Draw mask…')}
              </button>
            )}
            {inpaintMaskUrl && !masking && <div className="text-[10px] text-positive">{t('designer_mask_ready', 'Mask ready')}</div>}
            <AiGenerateButton
              busy={aiLoading === 'inpaint'}
              disabled={!!aiLoading || !element.src || !inpaintPrompt.trim() || !inpaintMaskUrl}
              onClick={handleInpaint}
            />
          </AiToolCard>
        )}

        {operationAvailable('outpaint') && (
          <AiToolCard
            id="outpaint"
            title={t('designer_expand_image_ai', 'Expand Image (AI)')}
            description={t('designer_ai_outpaint_desc', 'Extend the selected image or the whole page beyond its current boundaries.')}
            expanded={expanded === 'outpaint'}
            onToggle={() => toggle('outpaint')}
          >
            <AiGenerateButton disabled={!!aiLoading || !element.src} onClick={handleOutpaint} />
          </AiToolCard>
        )}
      </div>
    </div>
  );
};
