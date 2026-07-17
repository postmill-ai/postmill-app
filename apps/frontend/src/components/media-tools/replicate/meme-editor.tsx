'use client';

import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplicateStore } from './replicate.store';
import { EditorShell, toolbarBtn, toolbarPrimary } from './editor-shell';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';
import type { FileValue } from './fields/file';

interface CustomFontEntry {
  family: string;
  fileId: string;
  path: string;
  weights: number[];
}

interface TextLayer {
  id: string;
  text: string;
  fontSize: number;
  fontFamily: string;
  x: number;
  y: number;
  fill: string;
  outlineColor: string;
  outlineWidth: number;
  bold: boolean;
  italic: boolean;
}

const DEFAULT_FONTS = ['Impact', 'Arial', 'Comic Sans MS'];
const DEFAULT_COLORS = ['#ffffff', '#000000', '#ff0000', '#00ff00', '#0000ff', '#ffff00'];

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function buildFontString(layer: TextLayer) {
  const style = layer.italic ? 'italic ' : '';
  const weight = layer.bold ? 'bold ' : '';
  return `${style}${weight}${layer.fontSize}px "${layer.fontFamily}", sans-serif`;
}

const fieldLabel = 'text-[10px] uppercase tracking-wider text-newTextColor/65';
const fieldInput =
  'w-full px-2 py-1 rounded border border-studioBorder bg-newBgColor text-textColor text-xs focus:outline-none focus:border-designerAccent';

export function MemeEditor() {
  const t = useT();
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  const saveFolderId = useReplicateStore((s) => s.saveFolderId);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [baseImage, setBaseImage] = useState<FileValue | null>(null);
  const [layers, setLayers] = useState<TextLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState<string | null>(null);

  const { data: customFonts } = useSWR<CustomFontEntry[]>('replicate-meme-fonts', async () => {
    const res = await fetch('/media/fonts');
    if (!res.ok) return [];
    return res.json();
  });

  const fontOptions = useMemo(() => {
    const custom = (customFonts || []).map((f) => f.family);
    return [...new Set([...DEFAULT_FONTS, ...custom])];
  }, [customFonts]);

  const selectedLayer = useMemo(
    () => layers.find((l) => l.id === selectedLayerId) || null,
    [layers, selectedLayerId]
  );

  const loadFont = useCallback(
    async (fontFamily: string) => {
      if (typeof document === 'undefined' || !('fonts' in document)) return;
      if (DEFAULT_FONTS.includes(fontFamily)) return;
      const entry = customFonts?.find((f) => f.family === fontFamily);
      if (!entry) return;
      try {
        const existing = Array.from((document.fonts as any).values()).find((ff: any) => ff.family === fontFamily);
        if (existing) return;
        const fontFace = new FontFace(fontFamily, `url(${entry.path})`, {
          weight: entry.weights.map(String).join(', ') || '400',
        });
        const loaded = await fontFace.load();
        (document.fonts as any).add(loaded);
      } catch {
        /* fall back to system font */
      }
    },
    [customFonts]
  );

  const drawMeme = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !baseImage?.url) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = async () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      for (const layer of layers) {
        await loadFont(layer.fontFamily);
        ctx.font = buildFontString(layer);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const lines = layer.text.split('\n');
        const lineHeight = layer.fontSize * 1.2;
        lines.forEach((line, i) => {
          const y = layer.y + (i - (lines.length - 1) / 2) * lineHeight;
          ctx.lineWidth = layer.outlineWidth;
          ctx.strokeStyle = layer.outlineColor;
          ctx.strokeText(line.toUpperCase(), layer.x, y);
          ctx.fillStyle = layer.fill;
          ctx.fillText(line.toUpperCase(), layer.x, y);
        });
        // selection ring
        if (layer.id === selectedLayerId) {
          const maxWidth = Math.max(...lines.map((l) => ctx.measureText(l.toUpperCase()).width), 20);
          const halfH = (lines.length * lineHeight) / 2;
          ctx.strokeStyle = '#7c5cff';
          ctx.lineWidth = Math.max(2, layer.fontSize * 0.04);
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(layer.x - maxWidth / 2 - 8, layer.y - halfH - 4, maxWidth + 16, halfH * 2 + 8);
          ctx.setLineDash([]);
        }
      }
    };
    img.src = baseImage.url;
  }, [baseImage, layers, loadFont, selectedLayerId]);

  useEffect(() => {
    drawMeme();
  }, [drawMeme]);

  const handleChooseImage = useCallback(() => {
    modals.openModal({
      title: t('select_base_image', 'Select base image'),
      removeLayout: true,
      children: (close) => (
        <MediaSelectorModal
          open
          onClose={close}
          onSelect={(item) => {
            setBaseImage({ fileId: item.fileId, url: item.url, type: item.type });
            close();
          }}
        />
      ),
    });
  }, [modals, t]);

  const addLayer = useCallback(() => {
    const id = makeId();
    setLayers((prev) => [
      ...prev,
      {
        id,
        text: 'TEXT',
        fontSize: 48,
        fontFamily: fontOptions[0] || 'Impact',
        x: (canvasRef.current?.width || 800) / 2,
        y: (canvasRef.current?.height || 600) / 2,
        fill: '#ffffff',
        outlineColor: '#000000',
        outlineWidth: 4,
        bold: true,
        italic: false,
      },
    ]);
    setSelectedLayerId(id);
  }, [fontOptions]);

  const updateLayer = useCallback((id: string, patch: Partial<TextLayer>) => {
    setLayers((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const removeLayer = useCallback((id: string) => {
    setLayers((prev) => prev.filter((l) => l.id !== id));
    setSelectedLayerId((cur) => (cur === id ? null : cur));
  }, []);

  const handleExport = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setSaving(true);
    canvas.toBlob(async (blob) => {
      if (!blob) {
        toaster.show(t('could_not_render_meme', 'Could not render the meme image'), 'warning');
        setSaving(false);
        return;
      }
      const formData = new FormData();
      formData.append('file', blob, 'meme.png');
      if (saveFolderId) formData.append('folderId', saveFolderId);
      try {
        const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
        if (!res.ok) throw new Error(await res.text().catch(() => t('save_failed', 'Failed to save')));
        const data = await res.json();
        setSavedPath(data.path || data.name);
        toaster.show(t('saved_to_files', 'Saved to Files'), 'success');
      } catch (err) {
        toaster.show((err as Error).message || t('could_not_save_meme', 'Could not save the meme'), 'warning');
      } finally {
        setSaving(false);
      }
    }, 'image/png');
  }, [fetch, saveFolderId, toaster, t]);

  const handleOpenDesigner = useCallback(() => {
    if (savedPath) {
      openInDesigner({ operation: 'image', artifactUrl: savedPath });
    }
  }, [savedPath]);

  // Drag on canvas
  const dragRef = useRef({ layerId: null as string | null, startX: 0, startY: 0, origX: 0, origY: 0 });

  const getCanvasPos = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX ?? e.changedTouches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY ?? e.changedTouches[0]?.clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx || layers.length === 0) return;
      const pos = getCanvasPos(e);
      let hit: TextLayer | null = null;
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        ctx.font = buildFontString(layer);
        const lines = layer.text.split('\n');
        const lineHeight = layer.fontSize * 1.2;
        const maxWidth = Math.max(...lines.map((line) => ctx.measureText(line.toUpperCase()).width));
        const halfHeight = (lines.length * lineHeight) / 2;
        if (Math.abs(pos.x - layer.x) <= maxWidth / 2 + 10 && Math.abs(pos.y - layer.y) <= halfHeight + 10) {
          hit = layer;
          break;
        }
      }
      if (hit) {
        setSelectedLayerId(hit.id);
        dragRef.current = { layerId: hit.id, startX: pos.x, startY: pos.y, origX: hit.x, origY: hit.y };
      } else {
        setSelectedLayerId(null);
      }
    },
    [layers, getCanvasPos]
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!dragRef.current.layerId) return;
      e.preventDefault();
      const pos = getCanvasPos(e);
      const dx = pos.x - dragRef.current.startX;
      const dy = pos.y - dragRef.current.startY;
      updateLayer(dragRef.current.layerId, {
        x: Math.round(dragRef.current.origX + dx),
        y: Math.round(dragRef.current.origY + dy),
      });
    },
    [getCanvasPos, updateLayer]
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current.layerId = null;
  }, []);

  const toolbar = (
    <>
      <button onClick={handleChooseImage} className={toolbarBtn}>
        {baseImage ? t('change_image', 'Change image') : t('choose_image', 'Choose image')}
      </button>
      <button onClick={addLayer} disabled={!baseImage} className={toolbarBtn}>
        {t('plus_text', '+ Text')}
      </button>
      {savedPath && (
        <button onClick={handleOpenDesigner} className={toolbarBtn}>
          {t('open_in_designer', 'Open in Designer')}
        </button>
      )}
      <button
        onClick={handleExport}
        disabled={!baseImage || saving}
        className="px-3 py-1.5 rounded-lg bg-[#2B5CD3] text-white text-xs font-medium hover:bg-[#2B5CD3]/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
        </svg>
        {saving ? t('saving_ellipsis', 'Saving…') : t('save_to_files', 'Save to Files')}
      </button>
    </>
  );

  const inspector = (
    <div className="p-4 space-y-4">
      <div>
        <div className={`${fieldLabel} mb-2`}>{t('layers', 'Layers')}</div>
        {layers.length === 0 ? (
          <p className="text-xs text-newTextColor/65">{t('no_text_yet_add_layer', 'No text yet — add a text layer.')}</p>
        ) : (
          <div className="space-y-1">
            {layers.map((l, i) => (
              <div
                key={l.id}
                onClick={() => setSelectedLayerId(l.id)}
                className={`flex items-center justify-between px-2 py-1.5 rounded-lg cursor-pointer text-xs ${
                  selectedLayerId === l.id ? 'bg-designerAccent/20 text-textColor' : 'text-newTextColor/70 hover:bg-boxHover'
                }`}
              >
                <span className="truncate">
                  {i + 1}. {l.text.split('\n')[0] || 'TEXT'}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeLayer(l.id);
                  }}
                  className="text-dangerText hover:text-red-300 ml-2"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {selectedLayer && (
        <div className="space-y-3 border-t border-studioBorder pt-3">
          <div className={fieldLabel}>{t('provider_chip_text', 'Text')}</div>
          <textarea
            value={selectedLayer.text}
            onChange={(e) => updateLayer(selectedLayer.id, { text: e.target.value })}
            rows={2}
            className={`${fieldInput} resize-none uppercase`}
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className={fieldLabel}>{t('font', 'Font')}</div>
              <select
                value={selectedLayer.fontFamily}
                onChange={(e) => updateLayer(selectedLayer.id, { fontFamily: e.target.value })}
                className={fieldInput}
              >
                {fontOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className={fieldLabel}>{t('size', 'Size')}</div>
              <input
                type="number"
                min={8}
                max={400}
                value={selectedLayer.fontSize}
                onChange={(e) => updateLayer(selectedLayer.id, { fontSize: Number(e.target.value) })}
                className={fieldInput}
              />
            </div>
          </div>
          <div>
            <div className={fieldLabel}>{t('fill_button', 'Fill')}</div>
            <div className="flex gap-1 flex-wrap items-center">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => updateLayer(selectedLayer.id, { fill: c })}
                  className={`w-5 h-5 rounded border ${selectedLayer.fill === c ? 'border-designerAccent' : 'border-studioBorder'}`}
                  style={{ backgroundColor: c }}
                  aria-label={t('fill_color_aria', 'Fill {{color}}', { color: c })}
                />
              ))}
              <input
                type="color"
                value={selectedLayer.fill}
                onChange={(e) => updateLayer(selectedLayer.id, { fill: e.target.value })}
                className="w-6 h-6 p-0 border-0 bg-transparent"
              />
            </div>
          </div>
          <div>
            <div className={fieldLabel}>{t('outline', 'Outline')}</div>
            <div className="flex gap-1 flex-wrap items-center">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => updateLayer(selectedLayer.id, { outlineColor: c })}
                  className={`w-5 h-5 rounded border ${selectedLayer.outlineColor === c ? 'border-designerAccent' : 'border-studioBorder'}`}
                  style={{ backgroundColor: c }}
                  aria-label={t('outline_color_aria', 'Outline {{color}}', { color: c })}
                />
              ))}
              <input
                type="number"
                min={0}
                max={20}
                value={selectedLayer.outlineWidth}
                onChange={(e) => updateLayer(selectedLayer.id, { outlineWidth: Number(e.target.value) })}
                className={`${fieldInput} w-16`}
              />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-newTextColor/70">
              <input
                type="checkbox"
                checked={selectedLayer.bold}
                onChange={(e) => updateLayer(selectedLayer.id, { bold: e.target.checked })}
              />
              {t('bold', 'Bold')}
            </label>
            <label className="flex items-center gap-1.5 text-xs text-newTextColor/70">
              <input
                type="checkbox"
                checked={selectedLayer.italic}
                onChange={(e) => updateLayer(selectedLayer.id, { italic: e.target.checked })}
              />
              {t('italic', 'Italic')}
            </label>
          </div>
          <p className="text-[10px] text-newTextColor/65">
            {t('meme_drag_tip', 'Tip: drag the text directly on the canvas to position it.')}
          </p>
        </div>
      )}
    </div>
  );

  return (
    <EditorShell title={t('meme_editor_title', 'Meme Editor')} toolbar={toolbar} inspector={inspector}>
      {baseImage?.url ? (
        <div
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
          className="max-w-full max-h-full"
        >
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-[calc(100vh-200px)] object-contain rounded-lg border border-studioBorder cursor-move shadow-2xl"
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
          />
        </div>
      ) : (
        <button onClick={handleChooseImage} className={toolbarPrimary}>
          {t('choose_base_image_to_start', 'Choose a base image to start')}
        </button>
      )}
    </EditorShell>
  );
}
