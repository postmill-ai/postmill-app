'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { computeMediaDraw } from '@postmill-ai/nestjs-libraries/media/designer-doc/media-geometry';
import { pageChildren } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.pages';
import { Stepper } from '../controls';
import type { DesignerElement, DesignerOutput } from '../designer.store';
import { useLoadedImage } from '../elements';
import { detectFocalPoint } from '../reflow';
import { trySetPointerCapture } from '../pointer-capture';
import {
  containPreviewRect,
  focalPointForSourcePoint,
  focalThumbnailImageStyle,
  sourcePointForFocalPoint,
  sourcePointForPreviewPointer,
  zoomFocalPreview,
  type PreviewPoint,
  type PreviewView,
} from './focal-point-preview';

interface FocalPointEditorProps {
  element: DesignerElement;
  ids: string[];
  store: any;
}

const DEFAULT_FOCAL = { x: 0.5, y: 0.5 };
const DEFAULT_VIEW: PreviewView = { zoom: 1, pan: { x: 0, y: 0 } };
const QUICK_POSITIONS = [0, 0.5, 1].flatMap((y) =>
  [0, 0.5, 1].map((x) => ({ x, y }))
);

export const FocalPointEditor: React.FC<FocalPointEditorProps> = ({ element, ids, store }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const doc = store((s: any) => s.doc);
  const currentOutput = store((s: any) => s.currentOutput);
  const currentPage = store((s: any) => s.currentPage);
  const updateElements = store((s: any) => s.updateElements);
  const updateElementsSilent = store((s: any) => s.updateElementsSilent);
  const loaded = useLoadedImage(element.src);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const pointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef<PreviewPoint>(DEFAULT_FOCAL);
  const dragEndRef = useRef<PreviewPoint>(DEFAULT_FOCAL);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<PreviewView>(DEFAULT_VIEW);
  const [dragging, setDragging] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const source = useMemo(() => {
    const width = loaded?.naturalWidth || element.naturalWidth || 0;
    const height = loaded?.naturalHeight || element.naturalHeight || 0;
    return width > 0 && height > 0 ? { width, height } : null;
  }, [loaded, element.naturalWidth, element.naturalHeight]);

  const focalPoint = element.focalPoint || DEFAULT_FOCAL;
  const isCover = element.fitMode === 'cover';
  const interactive = isCover && !element.crop && !!source;

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const measure = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setView(DEFAULT_VIEW);
    pointerIdRef.current = null;
    setDragging(false);
  }, [element.id, element.src]);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!interactive || (!event.ctrlKey && !event.metaKey)) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((current) => zoomFocalPreview(
        current,
        pointer,
        current.zoom * Math.exp(-event.deltaY * 0.01)
      ));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const sourceRect = useMemo(
    () => source ? containPreviewRect(viewport, source) : { x: 0, y: 0, width: 0, height: 0 },
    [viewport, source]
  );
  const imageRect = element.fitMode === 'fill'
    ? { x: 0, y: 0, width: viewport.width, height: viewport.height }
    : sourceRect;

  const cropFrame = useMemo(() => {
    if (!source || !isCover) return null;
    const crop = computeMediaDraw({
      sourceWidth: source.width,
      sourceHeight: source.height,
      targetWidth: element.width,
      targetHeight: element.height,
      crop: element.crop,
      fitMode: element.fitMode,
      focalPoint: element.focalPoint,
    }).source;
    return {
      x: sourceRect.x + (crop.x / source.width) * sourceRect.width,
      y: sourceRect.y + (crop.y / source.height) * sourceRect.height,
      width: (crop.width / source.width) * sourceRect.width,
      height: (crop.height / source.height) * sourceRect.height,
    };
  }, [source, isCover, element.width, element.height, element.crop, element.fitMode, element.focalPoint, sourceRect]);

  const marker = useMemo(() => {
    if (!source || !cropFrame) return null;
    if (element.crop) {
      return {
        x: cropFrame.x + cropFrame.width / 2,
        y: cropFrame.y + cropFrame.height / 2,
      };
    }
    const point = sourcePointForFocalPoint(focalPoint, source, element);
    return {
      x: sourceRect.x + point.x * sourceRect.width,
      y: sourceRect.y + point.y * sourceRect.height,
    };
  }, [source, cropFrame, element, focalPoint, sourceRect]);

  const updateFromPointer = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!source) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const sourcePoint = sourcePointForPreviewPointer({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }, sourceRect, view);
    const next = focalPointForSourcePoint(sourcePoint, source, element);
    const accepted = updateElementsSilent(ids, { focalPoint: next });
    if (accepted) dragEndRef.current = next;
  }, [source, sourceRect, view, element, ids, updateElementsSilent]);

  const finishDrag = useCallback((pointerId: number) => {
    if (pointerIdRef.current !== pointerId) return;
    pointerIdRef.current = null;
    setDragging(false);
    if (dragEndRef.current.x !== dragStartRef.current.x || dragEndRef.current.y !== dragStartRef.current.y) {
      store.getState().pushHistory();
    }
  }, [store]);

  const setFocal = (next: PreviewPoint) => updateElements(ids, { focalPoint: next });
  const zoomAtCenter = (factor: number) => setView((current) => zoomFocalPreview(
    current,
    { x: viewport.width / 2, y: viewport.height / 2 },
    current.zoom * factor
  ));

  const detect = async () => {
    if (!element.src) return;
    setDetecting(true);
    try {
      const next = await detectFocalPoint(element.src, fetch);
      updateElements([element.id], { focalPoint: next });
    } catch {
      toaster.show(t('designer_subject_detection_failed', 'Subject detection failed; using center fallback'), 'warning');
    } finally {
      setDetecting(false);
    }
  };

  const formats = useMemo(() => doc.outputs.flatMap((output: DesignerOutput, index: number) => {
    if (!('children' in output)) return [];
    const children = pageChildren(output, currentPage);
    const match = index === currentOutput
      ? children.find((child) => child.id === element.id) || element
      : children.find((child) =>
          child.type === 'image' && (
            (element.originId && child.originId === element.originId) || child.id === element.id
          )
        );
    if (!match || match.type !== 'image') return [];
    return [{ output, element: match, index }];
  }), [doc, currentOutput, currentPage, element]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-textColor/50">{t('designer_label_focal_point', 'Focal point')}</span>
        {interactive && (
          <button
            type="button"
            className="text-[10px] text-btnPrimaryAccent disabled:opacity-50"
            disabled={detecting || !element.src}
            onClick={() => void detect()}
          >
            {detecting
              ? t('designer_detecting_ellipsis', 'Detecting…')
              : t('designer_auto_detect_subject', 'Auto-detect Subject')}
          </button>
        )}
      </div>

      <div
        ref={previewRef}
        role="group"
        aria-label={t('designer_focal_preview', 'Focal point preview')}
        data-focal-preview
        className={`relative h-[180px] rounded-md overflow-hidden border border-studioBorder bg-newBgColor ${
          interactive ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'
        }`}
        onPointerDown={(event) => {
          if (!interactive || event.button !== 0) return;
          event.preventDefault();
          trySetPointerCapture(event.currentTarget, event.pointerId);
          pointerIdRef.current = event.pointerId;
          dragStartRef.current = focalPoint;
          dragEndRef.current = focalPoint;
          setDragging(true);
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (pointerIdRef.current === event.pointerId) updateFromPointer(event);
        }}
        onPointerUp={(event) => finishDrag(event.pointerId)}
        onPointerCancel={(event) => finishDrag(event.pointerId)}
        onLostPointerCapture={(event) => finishDrag(event.pointerId)}
      >
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {element.src && (
            // eslint-disable-next-line @next/next/no-img-element -- external media file
            <img
              src={element.src}
              alt=""
              draggable={false}
              className="absolute max-w-none select-none"
              style={{
                left: imageRect.x,
                top: imageRect.y,
                width: imageRect.width,
                height: imageRect.height,
              }}
            />
          )}
          {cropFrame && (
            <div
              data-focal-crop-frame
              className="absolute border-2 border-white shadow-menu pointer-events-none"
              style={{
                left: cropFrame.x,
                top: cropFrame.y,
                width: cropFrame.width,
                height: cropFrame.height,
              }}
            />
          )}
          {marker && (
            <div
              data-focal-marker
              className="absolute w-5 h-5 rounded-full border-2 border-white bg-designerAccent shadow-menu pointer-events-none"
              style={{ left: marker.x - 10, top: marker.y - 10 }}
            />
          )}
        </div>
        {!source && (
          <div className="absolute inset-0 flex items-center justify-center text-[11px] text-newTableText">
            {t('designer_loading_image', 'Loading image…')}
          </div>
        )}
        {interactive && (
          <div
            className="absolute top-1 end-1 flex items-center rounded-sm border border-studioBorder bg-newBgColorInner/90 text-[10px] text-textColor"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              aria-label={t('zoom_out', 'Zoom out')}
              title={t('zoom_out', 'Zoom out')}
              disabled={view.zoom <= 1}
              onClick={() => zoomAtCenter(1 / 1.25)}
              className="w-6 h-6 disabled:opacity-40"
            >
              −
            </button>
            <button
              type="button"
              aria-label={t('designer_reset_focal_zoom', 'Reset preview zoom')}
              title={t('designer_reset_focal_zoom', 'Reset preview zoom')}
              onClick={() => setView(DEFAULT_VIEW)}
              className="min-w-10 h-6 px-1 border-x border-studioBorder"
            >
              {Math.round(view.zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label={t('zoom_in', 'Zoom in')}
              title={t('zoom_in', 'Zoom in')}
              disabled={view.zoom >= 4}
              onClick={() => zoomAtCenter(1.25)}
              className="w-6 h-6 disabled:opacity-40"
            >
              +
            </button>
          </div>
        )}
      </div>

      {!isCover && (
        <p className="text-[10px] text-newTableText">
          {t('designer_focal_cover_hint', 'Focal point applies when the image is cropped (Cover).')}
        </p>
      )}
      {isCover && element.crop && (
        <p className="text-[10px] text-newTableText">
          {t('designer_focal_explicit_crop_hint', 'Reset the explicit Crop below to adjust the focal point.')}
        </p>
      )}

      {interactive && (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
            <div role="group" className="grid grid-cols-3 gap-1" aria-label={t('designer_focal_quick_positions', 'Quick focal positions')}>
              {QUICK_POSITIONS.map((position) => {
                const active = Math.abs(focalPoint.x - position.x) < 0.001 && Math.abs(focalPoint.y - position.y) < 0.001;
                const label = t('designer_focal_quick_position', 'Set focal point: {{x}}%, {{y}}%', {
                  x: position.x * 100,
                  y: position.y * 100,
                });
                return (
                  <button
                    key={`${position.x}-${position.y}`}
                    type="button"
                    aria-label={label}
                    title={label}
                    aria-pressed={active}
                    onClick={() => setFocal(position)}
                    className={`w-7 h-6 flex items-center justify-center rounded-sm border ${
                      active
                        ? 'border-designerAccent bg-designerAccent/15'
                        : 'border-studioBorder bg-newBgColorInner hover:bg-boxHover'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-designerAccent' : 'bg-newTableText'}`} />
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 min-w-0">
              <Stepper
                compact
                label={t('designer_focal_x_percent', 'Focal X (%)')}
                min={0}
                max={100}
                step={1}
                value={Math.round(focalPoint.x * 100)}
                onChange={(x) => updateElementsSilent(ids, { focalPoint: { x: x / 100, y: focalPoint.y } })}
                onCommit={() => store.getState().pushHistory()}
              />
              <Stepper
                compact
                label={t('designer_focal_y_percent', 'Focal Y (%)')}
                min={0}
                max={100}
                step={1}
                value={Math.round(focalPoint.y * 100)}
                onChange={(y) => updateElementsSilent(ids, { focalPoint: { x: focalPoint.x, y: y / 100 } })}
                onCommit={() => store.getState().pushHistory()}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="text-[10px] text-btnPrimaryAccent"
              onClick={() => setFocal(DEFAULT_FOCAL)}
            >
              {t('designer_reset_focal_format', 'Reset this format')}
            </button>
          </div>
        </>
      )}

      {source && formats.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <div className="text-[10px] text-textColor/50">{t('designer_format_crops', 'Format crops')}</div>
          <div className="grid grid-cols-3 gap-2">
            {formats.map(({ output, element: formatElement, index }: { output: DesignerOutput; element: DesignerElement; index: number }) => {
              const style = focalThumbnailImageStyle(formatElement, source);
              const name = output.name || output.formatId || t('designer_format_label', 'Format');
              return (
                <figure key={output.id || index} className="min-w-0 space-y-1">
                  <div className="h-16 flex items-center justify-center">
                    <div
                      role="img"
                      aria-label={t('designer_format_crop_preview', '{{format}} crop preview', {
                        format: name,
                        interpolation: { escapeValue: false },
                      })}
                      data-focal-format={output.id || index}
                      className={`relative overflow-hidden rounded-sm border bg-newBgColor ${
                        index === currentOutput ? 'border-designerAccent' : 'border-studioBorder'
                      }`}
                      style={{
                        aspectRatio: `${formatElement.width} / ${formatElement.height}`,
                        ...(formatElement.width >= formatElement.height ? { width: '100%' } : { height: '100%' }),
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                      <img
                        src={formatElement.src}
                        alt=""
                        draggable={false}
                        className="absolute max-w-none"
                        style={{
                          left: `${style.left}%`,
                          top: `${style.top}%`,
                          width: `${style.width}%`,
                          height: `${style.height}%`,
                        }}
                      />
                    </div>
                  </div>
                  <figcaption className="text-[9px] text-newTableText truncate" title={name}>{name}</figcaption>
                </figure>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
