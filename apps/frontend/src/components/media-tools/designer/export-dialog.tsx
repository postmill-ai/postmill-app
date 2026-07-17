'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Stage, Layer, Rect, Image as KonvaImage } from 'react-konva';
import type Konva from 'konva';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useBrandColors } from './panels/use-brand-colors';
import { useBrandFonts } from './panels/use-brand-fonts';
import { getBrandViolations } from './brand-compliance';
import { CanvasElements, gradientFillProps, getImageNaturalSize } from './elements';
import type { DesignerDoc, DesignerOutput, VideoOutput } from './designer.store';
import { getThumbnailDataUrl } from './designer';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import type { Integrations } from '@gitroom/frontend/components/launches/calendar.context';

const useFocusTrap = (containerRef: React.RefObject<HTMLElement | null>) => {
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0] as HTMLElement | undefined;
    const last = focusable[focusable.length - 1] as HTMLElement | undefined;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    el.addEventListener('keydown', handler);
    const t = setTimeout(() => first?.focus(), 100);
    return () => {
      clearTimeout(t);
      el.removeEventListener('keydown', handler);
    };
  }, [containerRef]);
};

interface ExportDialogProps {
  store: any;
  onClose: () => void;
}

type Step = 'options' | 'folder' | 'export' | 'done' | 'draft-posts' | 'video-render' | 'video-rendering';
type FormatValue = 'png' | 'jpeg' | 'transparent' | 'webp' | 'pdf' | 'gif' | 'webp-animated' | 'mp4' | 'webm';

interface FormatDef {
  value: FormatValue;
  label: string;
  showQuality: boolean;
  showScale: boolean;
}

// Static image exports only. `gif`/`webp-animated` are intentionally NOT here:
// a single-frame Konva snapshot can't produce animation, so they only ever
// yielded a misleadingly-named static file. Animated output lives in VIDEO_FORMATS.
const FORMATS: FormatDef[] = [
  { value: 'png', label: 'PNG', showQuality: false, showScale: true },
  { value: 'jpeg', label: 'JPEG', showQuality: true, showScale: true },
  { value: 'transparent', label: 'Transparent PNG', showQuality: false, showScale: true },
  { value: 'webp', label: 'WebP', showQuality: true, showScale: true },
  { value: 'pdf', label: 'PDF', showQuality: false, showScale: false },
];

const VIDEO_FORMATS: FormatDef[] = [
  { value: 'mp4', label: 'MP4', showQuality: false, showScale: false },
  { value: 'webm', label: 'WebM', showQuality: false, showScale: false },
  { value: 'gif', label: 'GIF', showQuality: false, showScale: true },
  { value: 'webp-animated', label: 'Animated WebP', showQuality: true, showScale: true },
];

const SCALES = [
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
];

const QUALITY_MIN = 0.1;
const QUALITY_MAX = 1.0;
const QUALITY_STEP = 0.05;

const getDefaultFormat = (formatId: string): FormatValue => {
  if (formatId.startsWith('ig-')) return 'jpeg';
  if (formatId.startsWith('fb-')) return 'jpeg';
  if (formatId.startsWith('x-')) return 'webp';
  if (formatId.startsWith('linkedin-')) return 'webp';
  if (formatId.startsWith('tiktok')) return 'jpeg';
  if (formatId.startsWith('yt-')) return 'jpeg';
  if (formatId.startsWith('pinterest-')) return 'png';
  return 'png';
};

const mimeFor = (format: FormatValue): string => {
  const mimeMap: Record<string, string> = {
    'png': 'image/png',
    'jpeg': 'image/jpeg',
    'webp': 'image/webp',
    'transparent': 'image/png',
    'gif': 'image/gif',
    'webp-animated': 'image/webp',
  };
  return mimeMap[format] || 'image/png';
};

const extFor = (format: FormatValue): string => {
  const extMap: Record<string, string> = {
    'png': 'png',
    'jpeg': 'jpg',
    'webp': 'webp',
    'transparent': 'png',
    'gif': 'gif',
    'webp-animated': 'webp',
  };
  return extMap[format] || format;
};

interface ExportedFile {
  id: string;
  path: string;
  name: string;
  outputId: string;
  alt?: string;
  thumbnailPath?: string;
}

// --- Image preloader ---

const preloadImages = (output: DesignerOutput): Promise<void> => {
  const srcs = new Set<string>();
  if (output.bg?.type === 'image' && output.bg.src) srcs.add(output.bg.src);
  output.children.forEach((el) => {
    if (el.type === 'image' && el.src) srcs.add(el.src);
  });
  if (!srcs.size) return Promise.resolve();
  return Promise.all(
    Array.from(srcs).map(
      (src) =>
        new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = src;
        })
    )
  ).then(() => undefined);
};

// --- Render a single output to blob ---

const renderOutputToBlob = async (
  output: DesignerOutput,
  format: FormatValue,
  quality: number,
  pixelRatio: number
): Promise<Blob | null> => {
  await preloadImages(output);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.width = `${output.width}px`;
  host.style.height = `${output.height}px`;
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  const root = createRoot(host);
  const stageRef = React.createRef<Konva.Stage>();
  const transparent = format === 'transparent';
  const bg = output.bg;
  const bgGrad =
    bg?.type === 'gradient' ? gradientFillProps(bg.gradient, output.width, output.height) : {};
  const solidBg =
    bg?.type === 'gradient' ? undefined : bg?.color || output.background || '#ffffff';
  const bgImageSrc = bg?.type === 'image' ? bg.src : undefined;
  const bgImageEl = (() => {
    if (!bgImageSrc) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = bgImageSrc;
    return img;
  })();

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <Stage ref={stageRef} width={output.width} height={output.height}>
          <Layer>
            {!transparent && (
              <Rect
                x={0}
                y={0}
                width={output.width}
                height={output.height}
                fill={solidBg}
                {...bgGrad}
              />
            )}
            {!transparent && bg?.type === 'image' && bgImageEl && (
              <KonvaImage
                image={bgImageEl}
                x={0}
                y={0}
                width={output.width}
                height={output.height}
                listening={false}
              />
            )}
            <CanvasElements elements={output.children} onSelect={() => {}} />
          </Layer>
        </Stage>
      );
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    // The Konva render reads element bitmaps from the shared imageCache, which is
    // populated asynchronously (incl. the cross-origin proxy fallback). Two RAFs
    // aren't enough for a slow/proxied image, so wait until every element src is
    // actually cached (or a deadline), plus let the background <img> finish.
    {
      const srcs: string[] = [];
      for (const el of output.children) {
        if (el.type === 'image' && el.src) srcs.push(el.src);
      }
      if (bgImageEl && !bgImageEl.complete) {
        await new Promise<void>((res) => {
          const done = () => res();
          bgImageEl.addEventListener('load', done, { once: true });
          bgImageEl.addEventListener('error', done, { once: true });
          setTimeout(done, 5000);
        });
      }
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline && srcs.some((s) => !getImageNaturalSize(s))) {
        await new Promise((r) => setTimeout(r, 50));
      }
      await new Promise<void>((r) =>
        requestAnimationFrame(() => requestAnimationFrame(() => r()))
      );
    }

    const stage = stageRef.current;
    if (!stage) return null;
    stage.draw();

    const blob = await stage.toBlob({
      pixelRatio,
      mimeType: mimeFor(format),
      ...(format === 'jpeg' || format === 'webp' || format === 'webp-animated' ? { quality } : {}),
    });
    return (blob as Blob | null) ?? null;
  } finally {
    root.unmount();
    host.remove();
  }
};

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const renderOutputWithFallback = async (
  output: DesignerOutput,
  format: FormatValue,
  quality: number,
  scale: number
): Promise<{ blob: Blob; usedFormat: FormatValue; usedQuality: number; usedScale: number }> => {
  const tryRender = async (f: FormatValue, q: number, s: number) => {
    const blob = await renderOutputToBlob(output, f, q, s);
    if (!blob) throw new Error('Render failed');
    return blob;
  };

  let blob = await tryRender(format, quality, scale);
  if (blob.size <= MAX_UPLOAD_BYTES) {
    return { blob, usedFormat: format, usedQuality: quality, usedScale: scale };
  }

  // Fallback 1: JPEG at same scale with reduced quality.
  if (format !== 'jpeg') {
    const fallbackQ = Math.min(quality, 0.9);
    blob = await tryRender('jpeg', fallbackQ, scale);
    if (blob.size <= MAX_UPLOAD_BYTES) {
      return { blob, usedFormat: 'jpeg', usedQuality: fallbackQ, usedScale: scale };
    }
  }

  // Fallback 2: lower-quality JPEG at the same scale.
  const lowQ = 0.6;
  blob = await tryRender('jpeg', lowQ, scale);
  if (blob.size <= MAX_UPLOAD_BYTES) {
    return { blob, usedFormat: 'jpeg', usedQuality: lowQ, usedScale: scale };
  }

  // Fallback 3: drop to 1x JPEG.
  if (scale > 1) {
    blob = await tryRender('jpeg', 0.7, 1);
    if (blob.size <= MAX_UPLOAD_BYTES) {
      return { blob, usedFormat: 'jpeg', usedQuality: 0.7, usedScale: 1 };
    }
  }

  throw new Error('Could not reduce output under 10 MB');
};

// --- Thumbnail renderer ---

const renderOutputThumbnail = async (output: DesignerOutput): Promise<string | undefined> => {
  await preloadImages(output);

  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-100000px';
  host.style.top = '0';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);

  const root = createRoot(host);
  const stageRef = React.createRef<Konva.Stage>();
  const bg = output.bg;
  const bgGrad =
    bg?.type === 'gradient' ? gradientFillProps(bg.gradient, output.width, output.height) : {};
  const solidBg =
    bg?.type === 'gradient' ? undefined : bg?.color || output.background || '#ffffff';
  const bgImageSrc = bg?.type === 'image' ? bg.src : undefined;
  const bgImageEl = (() => {
    if (!bgImageSrc) return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = bgImageSrc;
    return img;
  })();

  try {
    await new Promise<void>((resolve) => {
      root.render(
        <Stage ref={stageRef} width={output.width} height={output.height}>
          <Layer>
            <Rect
              x={0}
              y={0}
              width={output.width}
              height={output.height}
              fill={solidBg}
              {...bgGrad}
            />
            {bg?.type === 'image' && bgImageEl && (
              <KonvaImage
                image={bgImageEl}
                x={0}
                y={0}
                width={output.width}
                height={output.height}
                listening={false}
              />
            )}
            <CanvasElements elements={output.children} onSelect={() => {}} />
          </Layer>
        </Stage>
      );
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });

    const stage = stageRef.current;
    if (!stage) return undefined;
    stage.draw();

    const canvas = stage.toCanvas();
    return getThumbnailDataUrl(canvas, 300);
  } finally {
    root.unmount();
    host.remove();
  }
};

// --- Main component ---

export const ExportDialog: FC<ExportDialogProps> = ({ store, onClose }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef);

  const [step, setStep] = useState<Step>('options');
  const [outputFormats, setOutputFormats] = useState<Record<string, FormatValue>>({});
  const [quality, setQuality] = useState(0.92);
  const [scale, setScale] = useState(1);
  const [exportAll, setExportAll] = useState(false);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const [exporting, setExporting] = useState(false);
  const [savedFiles, setSavedFiles] = useState<ExportedFile[]>([]);
  const [previews, setPreviews] = useState<{ idx: number; dataUrl: string }[]>([]);
  const [loadingPreviews, setLoadingPreviews] = useState(false);
  const previewDoneRef = useRef(false);

  const [videoFormat, setVideoFormat] = useState<'mp4' | 'webm' | 'gif' | 'webp-animated'>('mp4');
  const [videoQuality, setVideoQuality] = useState<'low' | 'medium' | 'high'>('medium');
  const [videoBitrateKbps, setVideoBitrateKbps] = useState<number>(5000);
  const [posterUrl, setPosterUrl] = useState<string>('');
  const [posterUploading, setPosterUploading] = useState(false);
  const [renderedPosterUrl, setRenderedPosterUrl] = useState<string>('');
  const [posterSource, setPosterSource] = useState<'rendered' | 'custom'>('rendered');

  interface RenderJob {
    id: string;
    outputId: string;
    outputName: string;
    format: 'mp4' | 'webm' | 'gif' | 'webp-animated';
    status: string;
    progress: number;
    artifactUrl: string | null;
    thumbnailUrl: string | null;
    error: string;
  }
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const renderJobsRef = useRef(renderJobs);
  useEffect(() => {
    renderJobsRef.current = renderJobs;
  }, [renderJobs]);
  const [isEnqueuing, setIsEnqueuing] = useState(false);
  const renderStatus = useMemo(
    () => (renderJobs.length ? (renderJobs.every((j) => j.status === 'completed') ? 'completed' : renderJobs.some((j) => j.status === 'failed') ? 'failed' : 'rendering') : ''),
    [renderJobs]
  );
  const renderProgress = useMemo(
    () => (renderJobs.length ? Math.round(renderJobs.reduce((sum, j) => sum + j.progress, 0) / renderJobs.length) : 0),
    [renderJobs]
  );
  const renderError = useMemo(
    () => renderJobs.find((j) => j.error)?.error || '',
    [renderJobs]
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const doc: DesignerDoc = store((s: any) => s.doc);
  const multiOutput = doc.outputs.length > 1;
  const isVideoMode = doc.mode === 'video';

  const user = useUser();
  const brandColors = useBrandColors();
  const brandFonts = useBrandFonts();
  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const brandAdminOverride = store((s: any) => s.brandAdminOverride);
  const brandViolations = useMemo(
    () =>
      getBrandViolations(doc, {
        enforcement: brandEnforcement,
        adminOverride: brandAdminOverride,
        brandColors,
        brandFonts,
      }),
    [doc, brandEnforcement, brandAdminOverride, brandColors, brandFonts]
  );
  const canAdminOverride = user?.role === 'owner' || user?.role === 'admin';
  const isBrandCompliant = brandViolations.length === 0 || brandAdminOverride;

  const selectedOutputs = useMemo(() => {
    const state = store.getState();
    if (exportAll || !multiOutput) {
      return doc.outputs;
    }
    return [doc.outputs[state.currentOutput]];
  }, [doc.outputs, exportAll, multiOutput, store]);

  const outputCount = selectedOutputs.length;

  const activeOutputId = useMemo(() => {
    if (selectedOutputs.length === 1) return selectedOutputs[0].id;
    return '';
  }, [selectedOutputs]);

  const activeFormat = useMemo(
    () => (activeOutputId ? outputFormats[activeOutputId] || 'png' : 'png'),
    [activeOutputId, outputFormats]
  );

  const formatDefs = isVideoMode ? VIDEO_FORMATS : FORMATS;
  const activeFormatDef = formatDefs.find((f) => f.value === activeFormat);

  // Format labels are mostly universal file-format acronyms (PNG, JPEG, MP4…) left
  // untranslated; only the descriptive compound labels carry translatable English words.
  const formatLabel = (f: FormatDef): string => {
    if (f.value === 'transparent') return t('designer_format_transparent_png', 'Transparent PNG');
    if (f.value === 'webp-animated') return t('designer_format_webp_animated', 'Animated WebP');
    return f.label;
  };

  useEffect(() => {
    const map: Record<string, FormatValue> = {};
    for (const output of doc.outputs) {
      map[output.id] = isVideoMode ? 'mp4' : getDefaultFormat(output.formatId);
    }
    setOutputFormats((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const [id, fmt] of Object.entries(map)) {
        if (!(id in next)) {
          next[id] = fmt;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [doc.outputs, isVideoMode]);

  const setFormatForOutput = useCallback((outputId: string, fmt: FormatValue) => {
    setOutputFormats((prev) => ({ ...prev, [outputId]: fmt }));
  }, []);

  const setFormatForAll = useCallback((fmt: FormatValue) => {
    setOutputFormats((prev) => {
      const next = { ...prev };
      for (const id of Object.keys(next)) {
        next[id] = fmt;
      }
      return next;
    });
  }, []);

  // --- Folder tree ---

  const { data: folders, mutate: mutateFolders } = useSWR(
    'save-folders',
    async () => {
      const res = await fetch('/files/folders');
      if (!res.ok) return [];
      return res.json();
    }
  );

  const { data: providersMap } = useSWR<Record<string, { type: string; name: string }>>(
    'save-folders-storage-providers',
    async () => {
      const res = await fetch('/settings/storage');
      if (!res.ok) return {};
      const providers = await res.json();
      const map: Record<string, { type: string; name: string }> = {};
      for (const p of providers) map[p.id] = { type: p.type, name: p.name };
      return map;
    },
    { revalidateOnFocus: false, dedupingInterval: 60000 }
  );

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    await fetch('/files/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim(), parentId: selectedFolderId }),
    });
    setNewFolderName('');
    mutateFolders();
  }, [newFolderName, selectedFolderId, fetch, mutateFolders]);

  const renderFolderTree = useCallback(
    (items: any[], depth: number = 0): React.ReactNode => {
      return (items || []).map((folder: any) => {
        const providerInfo =
          folder.storageProviderId && providersMap?.[folder.storageProviderId];
        return (
          <div key={folder.id}>
            <button
              type="button"
              className={`flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] cursor-pointer text-[13px] transition-all border-0 bg-transparent text-left w-full ${
                selectedFolderId === folder.id
                  ? 'bg-designerAccent/20 text-textColor'
                  : 'text-textColor hover:bg-studioBorder/50'
              }`}
              style={{ paddingLeft: `${12 + depth * 16}px` }}
              onClick={() => setSelectedFolderId(folder.id)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path
                  d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z"
                  fill={selectedFolderId === folder.id ? '#2B5CD3' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
              </svg>
              <span className="flex-1 truncate">{folder.name}</span>
              {providerInfo && (
                <span className="inline-flex items-center gap-[4px] bg-designerAccent/15 rounded-[4px] px-[5px] py-[2px] text-[11px] text-newTextColor/70">
                  <ProviderIcon
                    identifier={providerInfo.type}
                    name={providerInfo.name}
                    size={14}
                  />
                  {providerInfo.type}
                </span>
              )}
              <span className="text-[11px] text-newTextColor/60">
                {folder._count?.files || 0}
              </span>
            </button>
            {folder.children?.length ? renderFolderTree(folder.children, depth + 1) : null}
          </div>
        );
      });
    },
    [selectedFolderId, providersMap]
  );

  // --- Step transitions ---

  const goToFolder = useCallback(() => setStep('folder'), []);
  const goToOptions = useCallback(() => setStep('options'), []);
  const goToExport = useCallback(() => {
    if (isVideoMode) {
      setStep('video-render');
    } else {
      setStep('export');
    }
  }, [isVideoMode]);

  const startVideoRender = useCallback(async () => {
    setRenderJobs([]);
    setIsEnqueuing(true);
    try {
      const outputsToRender = exportAll
        ? doc.outputs.filter((o) => 'tracks' in o)
        : [doc.outputs[store.getState().currentOutput || 0]];
      const jobs: RenderJob[] = [];
      for (let i = 0; i < outputsToRender.length; i++) {
        const composition = outputsToRender[i];
        const chosenFormat = outputFormats[composition.id];
        const outputFormat: RenderJob['format'] =
          chosenFormat === 'mp4' ||
          chosenFormat === 'webm' ||
          chosenFormat === 'gif' ||
          chosenFormat === 'webp-animated'
            ? chosenFormat
            : videoFormat;
        const res = await fetch('/media/designs/render-video', {
          method: 'POST',
          body: JSON.stringify({
            composition,
            outputIndex: i,
            format: outputFormat,
            quality: videoQuality === 'high' ? 1 : videoQuality === 'medium' ? 0.7 : 0.4,
            bitrateKbps: videoBitrateKbps,
            posterUrl: posterUrl || undefined,
            folderId: selectedFolderId || undefined,
          }),
        });
        if (!res.ok) {
          toaster.show(
            t('designer_failed_to_enqueue_render_for_name', 'Failed to enqueue render for {{name}}', {
              name: composition.name || composition.formatId,
            }),
            'warning'
          );
          continue;
        }
        const { id } = await res.json();
        jobs.push({
          id,
          outputId: composition.id,
          outputName: composition.name || composition.formatId || `output_${i + 1}`,
          format: outputFormat,
          status: 'rendering',
          progress: 0,
          artifactUrl: null,
          thumbnailUrl: null,
          error: '',
        });
      }

      if (jobs.length === 0) {
        setRenderJobs([{ id: '', outputId: '', outputName: '', format: videoFormat, status: 'failed', progress: 0, artifactUrl: null, thumbnailUrl: null, error: t('designer_no_video_renders_could_be_enqueued', 'No video renders could be enqueued') }]);
        return;
      }

      setRenderJobs(jobs);
      setStep('video-rendering');
    } catch (err) {
      setRenderJobs([{ id: '', outputId: '', outputName: '', format: videoFormat, status: 'failed', progress: 0, artifactUrl: null, thumbnailUrl: null, error: (err as Error).message || t('designer_failed_to_start_render', 'Failed to start render') }]);
    } finally {
      setIsEnqueuing(false);
    }
  }, [doc, store, exportAll, outputFormats, videoFormat, videoQuality, videoBitrateKbps, posterUrl, selectedFolderId, fetch, toaster]);

  useEffect(() => {
    if (step !== 'video-rendering' || renderJobsRef.current.length === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }

    const poll = async () => {
      try {
        const currentJobs = renderJobsRef.current;
        const pendingJobs = currentJobs.filter((j) => j.id && j.status !== 'completed' && j.status !== 'failed');
        if (pendingJobs.length === 0) return;
        const nextJobs = await Promise.all(
          currentJobs.map(async (job) => {
            if (job.status === 'completed' || job.status === 'failed' || !job.id) return job;
            const res = await fetch(`/media/designs/render-video/${job.id}`);
            if (!res.ok) return job;
            const data = await res.json();
            return {
              ...job,
              progress: data.progress || 0,
              status: data.status,
              artifactUrl: data.status === 'completed' ? data.artifactUrl || null : job.artifactUrl,
              thumbnailUrl: data.status === 'completed' ? data.thumbnailUrl || null : job.thumbnailUrl,
              error: data.status === 'failed' ? data.errorMessage || t('designer_render_failed', 'Render failed') : job.error,
            };
          })
        );
        const completedThumb = nextJobs.find((j) => j.status === 'completed' && j.thumbnailUrl)?.thumbnailUrl;
        if (completedThumb) {
          setRenderedPosterUrl(completedThumb);
          if (posterSource === 'rendered') {
            setPosterUrl(completedThumb);
          }
        }
        setRenderJobs(nextJobs);
      } catch {}
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [step, fetch, posterSource]);

  const handleVideoDone = useCallback(() => {
    const files: ExportedFile[] = renderJobs
      .filter((j) => j.status === 'completed' && j.artifactUrl)
      .map((j) => ({
        id: j.id,
        path: j.artifactUrl || '',
        thumbnailPath: posterUrl || undefined,
        name: `${j.outputName}.${extFor(j.format)}`,
        outputId: j.outputId,
      }));
    setSavedFiles(files.length ? files : []);
    setStep('done');
  }, [renderJobs, posterUrl]);

  // --- T-30: Draft posts state ---

  interface DraftRow {
    output: DesignerOutput | VideoOutput;
    outputIdx: number;
    file: ExportedFile;
    provider: string | null;
    integration: Integrations | null;
    integrationName: string;
    checked: boolean;
    altText: string;
    missingAlt: boolean;
  }

  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftCreating, setDraftCreating] = useState(false);

  const goToDraftPosts = useCallback(async () => {
    setStep('draft-posts');
    setDraftLoading(true);
    try {
      const res = await fetch('/integrations');
      const allIntegrations: Integrations[] = res.ok ? await res.json() : [];

      const rows: DraftRow[] = [];
      for (let i = 0; i < savedFiles.length; i++) {
        const file = savedFiles[i];
        const output = doc.outputs.find((o) => o.id === file.outputId);
        if (!output) continue;
        const preset = CHANNEL_PRESETS.find((p) => p.id === output.formatId);
        const provider = preset?.provider ?? null;

        const altFromElements = 'children' in output
          ? (output as DesignerOutput).children
              .filter((el) => el.type === 'image')
              .map((el) => el.alt)
              .filter(Boolean)
              .join(' | ')
          : '';

        const hasAlt = !!file.alt || !!altFromElements;
        const hasImageElements = 'children' in output
          ? (output as DesignerOutput).children.some((el) => el.type === 'image')
          : false;

        if (!provider) {
          rows.push({
            output,
            outputIdx: i,
            file,
            provider: null,
            integration: null,
            integrationName: t('designer_no_supported_channel_skipped', 'No supported channel — skipped'),
            checked: false,
            altText: file.alt || altFromElements || '',
            missingAlt: !hasAlt && hasImageElements,
          });
          continue;
        }

        const matchingIntegrations = allIntegrations.filter(
          (integ) => integ.id === provider || integ.id.startsWith(provider + '-')
        );

        if (!matchingIntegrations.length) {
          rows.push({
            output,
            outputIdx: i,
            file,
            provider,
            integration: null,
            integrationName: t('designer_no_connected_provider_accounts_skipped', 'No connected {{provider}} accounts — skipped', { provider }),
            checked: false,
            altText: file.alt || altFromElements || '',
            missingAlt: !hasAlt && hasImageElements,
          });
          continue;
        }

        for (const integ of matchingIntegrations) {
          rows.push({
            output,
            outputIdx: i,
            file,
            provider,
            integration: integ,
            integrationName: integ.name,
            checked: true,
            altText: file.alt || altFromElements || '',
            missingAlt: !hasAlt && hasImageElements,
          });
        }
      }
      setDraftRows(rows);
    } catch {
      toaster.show(t('designer_failed_to_load_integrations', 'Failed to load integrations'), 'warning');
    } finally {
      setDraftLoading(false);
    }
  }, [savedFiles, doc.outputs, fetch, toaster]);

  const toggleDraftRow = useCallback((idx: number) => {
    setDraftRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, checked: !r.checked } : r))
    );
  }, []);

  const setAltText = useCallback((idx: number, text: string) => {
    setDraftRows((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, altText: text } : r))
    );
  }, []);

  const confirmedDraftCount = useMemo(
    () => draftRows.filter((r) => r.checked && r.integration).length,
    [draftRows]
  );

  const handleCreateDraftPosts = useCallback(async () => {
    setDraftCreating(true);
    let created = 0;
    let failed = 0;

    for (const row of draftRows) {
      if (!row.checked || !row.integration) continue;
      try {
        const mediaItem: { id: string; path: string; alt?: string; thumbnail?: string } = {
          id: row.file.id,
          path: row.file.path,
          alt: row.altText || undefined,
        };
        if (row.file.thumbnailPath) {
          mediaItem.thumbnail = row.file.thumbnailPath;
        }

        const payload = {
          type: 'draft' as const,
          date: new Date().toISOString(),
          shortLink: false,
          tags: [] as string[],
          posts: [
            {
              integration: { id: row.integration.id },
              value: [
                {
                  content: '',
                  image: [mediaItem],
                },
              ],
            },
          ],
        };

        const res = await fetch('/posts', {
          method: 'POST',
          body: JSON.stringify(payload),
        });

        if (res.ok) {
          created++;
        } else {
          failed++;
          toaster.show(
            t('designer_failed_to_create_draft_for', 'Failed to create draft for {{name}}', {
              name: row.integrationName,
            }),
            'warning'
          );
        }
      } catch {
        failed++;
        toaster.show(
          t('designer_failed_to_create_draft_for', 'Failed to create draft for {{name}}', {
            name: row.integrationName,
          }),
          'warning'
        );
      }
    }

    if (created > 0) {
      toaster.show(
        t('designer_n_drafts_created', '{{count}} draft created', {
          count: created,
        }),
        'success'
      );
    }
    if (failed === 0 && created > 0) {
      onClose();
    }
    setDraftCreating(false);
  }, [draftRows, fetch, toaster, onClose]);

  // Pre-fill alt from the output's alt when exporting
  const getOutputAlt = useCallback(
    (outputId: string): string | undefined => {
      const output = doc.outputs.find((o) => o.id === outputId);
      if (!output || !('children' in output)) return undefined;
      return (output as DesignerOutput).children
        .filter((el) => el.type === 'image')
        .map((el) => el.alt)
        .filter(Boolean)
        .join(' | ') || undefined;
    },
    [doc.outputs]
  );

  // --- Upload ---

  const pingDownload = useCallback(async () => {
    const attribution = store.getState().doc.attribution;
    if (attribution?.source === 'unsplash' && attribution.downloadLocation) {
      try {
        await fetch('/media/stock/download', {
          method: 'POST',
          body: JSON.stringify({ downloadLocation: attribution.downloadLocation }),
        });
      } catch {}
    }
  }, [store, fetch]);

  const uploadBlob = useCallback(
    async (
      blob: Blob,
      fileName: string
    ): Promise<{ id: string; path: string } | null> => {
      const attribution = store.getState().doc.attribution;
      const formData = new FormData();
      formData.append('file', blob, fileName);
      if (attribution?.source) formData.append('source', attribution.source);
      if (attribution?.downloadLocation)
        formData.append('downloadLocation', attribution.downloadLocation);
      if (attribution?.author) formData.append('author', attribution.author);
      if (attribution?.authorUrl) formData.append('authorUrl', attribution.authorUrl);
      if (selectedFolderId) formData.append('folderId', selectedFolderId);

      // upload-simple is capped at 10 MB; fall back to the server-side endpoint for larger files.
      const endpoint = blob.size > MAX_UPLOAD_BYTES ? '/files/upload-server' : '/files/upload-simple';
      const res = await fetch(endpoint, { method: 'POST', body: formData });
      if (!res.ok) return null;
      return res.json();
    },
    [store, fetch, selectedFolderId]
  );

  // --- Thumbnail generation (for step 3) ---

  const generatePreviews = useCallback(async () => {
    if (previewDoneRef.current) return;
    previewDoneRef.current = true;
    setLoadingPreviews(true);
    const result: { idx: number; dataUrl: string }[] = [];
    for (let i = 0; i < selectedOutputs.length; i++) {
      const out = selectedOutputs[i];
      if (!('children' in out)) continue;
      const dataUrl = await renderOutputThumbnail(out as DesignerOutput);
      if (dataUrl) result.push({ idx: i, dataUrl });
    }
    setPreviews(result);
    setLoadingPreviews(false);
  }, [selectedOutputs]);

  useEffect(() => {
    if (step === 'export') {
      previewDoneRef.current = false;
      setPreviews([]);
      generatePreviews();
    }
  }, [step, generatePreviews]);

  // --- Server-side PDF render ---

  const renderPdfOnServer = useCallback(async (outputs?: DesignerOutput[]): Promise<Blob | null> => {
    const pdfOutputs = (outputs ?? (selectedOutputs as DesignerOutput[]));
    const pdfDoc: DesignerDoc = { ...doc, outputs: pdfOutputs };
    const res = await fetch('/media/designs/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc: pdfDoc, format: 'pdf' }),
    });
    if (!res.ok) return null;
    return res.blob();
  }, [doc, selectedOutputs, fetch]);

  // --- Export handler ---

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const state = store.getState();
      const baseName = (state.designName || 'design').replace(/[^a-zA-Z0-9]/g, '_');

      await pingDownload();

      const results: ExportedFile[] = [];

      const allPdf = selectedOutputs.every((o) => (outputFormats[o.id] || 'png') === 'pdf');

      if (allPdf) {
        const pdfBlob = await renderPdfOnServer();
        if (!pdfBlob) {
          toaster.show(t('designer_pdf_render_failed', 'PDF render failed'), 'warning');
          return;
        }
        const pdfName =
          selectedOutputs.length === 1
            ? `${baseName} - ${(selectedOutputs[0].name || selectedOutputs[0].formatId || 'output').replace(/[^a-zA-Z0-9]/g, '_')}.pdf`
            : `${baseName} - Combined.pdf`;
        const saved = await uploadBlob(pdfBlob, pdfName);
        if (saved) {
          results.push({
            id: saved.id,
            path: saved.path,
            name: pdfName,
            outputId: selectedOutputs[0].id,
          });
        }
      } else {
        for (let i = 0; i < selectedOutputs.length; i++) {
          const output = selectedOutputs[i];
          const fmt = outputFormats[output.id] || 'png';
          try {
            const outputName = (output.name || output.formatId || `output_${i + 1}`).replace(
              /[^a-zA-Z0-9]/g,
              '_'
            );
            // A per-output PDF (in a mixed selection) must go through the server
            // renderer — Konva's toBlob can't emit PDF and would otherwise write a
            // PNG named ".pdf".
            if (fmt === 'pdf') {
              const pdfBlob = await renderPdfOnServer([output as DesignerOutput]);
              if (!pdfBlob) throw new Error('PDF render failed');
              const fileName = `${baseName} - ${outputName}.pdf`;
              const saved = await uploadBlob(pdfBlob, fileName);
              if (saved) {
                results.push({ id: saved.id, path: saved.path, name: fileName, outputId: output.id });
              }
              continue;
            }
            const { blob, usedFormat } = await renderOutputWithFallback(
              output as DesignerOutput,
              fmt,
              quality,
              scale
            );
            const ext = extFor(usedFormat);
            const fileName = `${baseName} - ${outputName}.${ext}`;
            const saved = await uploadBlob(blob, fileName);
            if (saved) {
              const alt = getOutputAlt(output.id);
              results.push({
                id: saved.id,
                path: saved.path,
                name: fileName,
                outputId: output.id,
                alt,
              });
            }
          } catch (err) {
            toaster.show((err as Error).message || t('designer_export_failed', 'Export failed'), 'warning');
            setExporting(false);
            return;
          }
        }
      }

      if (!results.length) {
        toaster.show(t('designer_export_failed', 'Export failed'), 'warning');
        return;
      }

      setSavedFiles(results);
      toaster.show(
        t('designer_exported_n_files', 'Exported {{count}} file', {
          count: results.length,
        }),
        'success'
      );
      setStep('done');
    } catch {
      toaster.show(t('designer_export_failed', 'Export failed'), 'warning');
    } finally {
      setExporting(false);
    }
  }, [
    store,
    outputFormats,
    quality,
    scale,
    selectedOutputs,
    pingDownload,
    renderPdfOnServer,
    uploadBlob,
    toaster,
    getOutputAlt,
  ]);

  // --- Render ---

  return (
    <div ref={dialogRef} className="flex flex-col gap-4 w-[420px] max-w-full">
      <div className="text-[16px] font-semibold text-textColor">{t('designer_export_design_title', 'Export Design')}</div>

      {/* ---- Step 1: Options ---- */}
      {step === 'options' && (
        <>
          <div className="flex flex-col gap-2">
            <div className="text-[13px] font-medium text-textColor mb-1">{t('designer_format_label', 'Format')}</div>

            {selectedOutputs.map((output) => {
              const fmt = outputFormats[output.id] || 'png';
              const preset = CHANNEL_PRESETS.find((p) => p.id === output.formatId);
              return (
                <div
                  key={output.id}
                  className="flex items-center justify-between gap-2 px-2 py-1 rounded-[6px] bg-newBgColorInner border border-studioBorder/50"
                >
                  <span className="text-[12px] text-textColor truncate flex-1">
                    {preset?.name || output.name || output.formatId}
                  </span>
                  <select
                    value={fmt}
                    onChange={(e) => setFormatForOutput(output.id, e.target.value as FormatValue)}
                    className="h-[30px] px-2 rounded-[5px] bg-newBgColor border border-studioBorder text-[12px] text-textColor outline-none cursor-pointer"
                  >
                    {formatDefs.map((f) => (
                      <option key={f.value} value={f.value}>
                        {formatLabel(f)}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}

            {selectedOutputs.length > 1 && (
              <div className="flex gap-1 mt-1">
                {formatDefs.map((f) => (
                  <button
                    key={f.value}
                    onClick={() => setFormatForAll(f.value)}
                    className="px-2 py-0.5 rounded-[4px] text-[10px] border border-studioBorder text-newTextColor/65 hover:text-textColor hover:border-newTextColor/40 transition-all"
                  >
                    {t('designer_all_format', 'All {{format}}', { format: formatLabel(f) })}
                  </button>
                ))}
              </div>
            )}
          </div>

          {activeFormatDef?.showQuality && (
            <div className="flex flex-col gap-1">
              <div className="flex justify-between text-[13px] font-medium text-textColor mb-1">
                <span>{t('designer_quality_label', 'Quality')}</span>
                <span className="text-newTextColor/60">{Math.round(quality * 100)}%</span>
              </div>
              <input
                type="range"
                min={QUALITY_MIN}
                max={QUALITY_MAX}
                step={QUALITY_STEP}
                value={quality}
                onChange={(e) => setQuality(parseFloat(e.target.value))}
                className="w-full accent-designerAccent"
              />
            </div>
          )}

          {activeFormatDef?.showScale && (
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-medium text-textColor mb-1">{t('designer_scale_label', 'Scale')}</div>
              <div className="flex gap-2">
                {SCALES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setScale(s.value)}
                    className={`flex-1 h-[36px] rounded-[6px] text-[13px] font-medium transition-all ${
                      scale === s.value
                        ? 'bg-designerAccent text-white'
                        : 'border border-studioBorder text-textColor hover:bg-boxHover'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {multiOutput && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={exportAll}
                onChange={(e) => setExportAll(e.target.checked)}
                className="accent-designerAccent w-[16px] h-[16px]"
              />
              <span className="text-[13px] text-textColor">
                {exportAll
                  ? t('designer_export_all_n_outputs', 'Export all {{count}} outputs', { count: doc.outputs.length })
                  : t('designer_export_current_output', 'Export current output')}
              </span>
            </label>
          )}

          {!multiOutput && (
            <div className="text-[13px] text-newTextColor/60">
              {t('designer_exporting_current_output', 'Exporting current output')}
            </div>
          )}

          {brandEnforcement && brandViolations.length > 0 && (
            <div className="rounded-[6px] border border-red-400/30 bg-red-400/10 p-2">
              <div className="text-[12px] text-dangerText font-medium mb-1">
                {t('designer_off_brand_elements_detected', 'Off-brand elements detected')}
              </div>
              <ul className="text-[11px] text-newTextColor/60 list-disc pl-4 space-y-0.5 max-h-[100px] overflow-y-auto">
                {brandViolations.slice(0, 4).map((v, i) => (
                  <li key={i}>{t(v.key, v.text, v.vars)}</li>
                ))}
                {brandViolations.length > 4 && (
                  <li>{t('designer_and_n_more', '…and {{count}} more', { count: brandViolations.length - 4 })}</li>
                )}
              </ul>
              {canAdminOverride && (
                <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={brandAdminOverride}
                    onChange={(e) =>
                      store.getState().setBrandAdminOverride(e.target.checked)
                    }
                    className="accent-purple-500 w-[14px] h-[14px]"
                  />
                  <span className="text-[11px] text-newTextColor/70">
                    {t('designer_admin_override_allow_export', 'Admin override — allow export')}
                  </span>
                </label>
              )}
            </div>
          )}

          <div className="flex justify-between gap-2 mt-2">
            <button
              onClick={onClose}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('cancel', 'Cancel')}
            </button>
            <button
              onClick={goToFolder}
              disabled={!isBrandCompliant}
              className="px-4 h-[38px] rounded-[6px] bg-designerAccent text-white text-[13px] font-medium hover:bg-designerAccent/80 disabled:opacity-50 transition-all"
            >
              {t('designer_next_choose_folder', 'Next: Choose Folder')}
            </button>
          </div>
        </>
      )}

      {/* ---- Step 2: Folder ---- */}
      {step === 'folder' && (
        <>
          <div className="text-[13px] font-medium text-textColor">{t('designer_choose_destination_folder', 'Choose destination folder')}</div>

          <div className="max-h-[260px] overflow-y-auto border border-studioBorder rounded-[8px] p-[8px] bg-newBgColorInner">
            <button
              type="button"
              className={`flex items-center gap-[8px] px-[8px] py-[6px] rounded-[6px] cursor-pointer text-[13px] transition-all border-0 bg-transparent text-left w-full ${
                selectedFolderId === null
                  ? 'bg-designerAccent/20 text-textColor'
                  : 'text-textColor hover:bg-studioBorder/50'
              }`}
              onClick={() => setSelectedFolderId(null)}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect
                  x="1"
                  y="2"
                  width="14"
                  height="12"
                  rx="2"
                  stroke="currentColor"
                  strokeWidth="1.3"
                />
                <path d="M1 6H15" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              <span className="flex-1 truncate">{t('designer_all_files_root', 'All Files (root)')}</span>
            </button>
            {folders && renderFolderTree(folders)}
          </div>

          <div className="flex gap-[8px] items-center">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder={t('designer_new_folder_name_placeholder', 'New folder name...')}
              className="flex-1 h-[36px] px-[12px] rounded-[8px] bg-newBgColorInner border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
              }}
            />
            <button
              onClick={handleCreateFolder}
              className="px-[12px] h-[36px] rounded-[8px] bg-btnSimple text-textColor text-[13px] hover:bg-boxHover transition-all"
            >
              {t('designer_create', 'Create')}
            </button>
          </div>

          <div className="flex justify-between gap-2 mt-2">
            <button
              onClick={goToOptions}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('back', 'Back')}
            </button>
            <button
              onClick={goToExport}
              className="px-4 h-[38px] rounded-[6px] bg-designerAccent text-white text-[13px] font-medium hover:bg-designerAccent/80 transition-all"
            >
              {t('designer_next_export_n_files', 'Next: Export {{count}} file', { count: outputCount })}
            </button>
          </div>
        </>
      )}

      {/* ---- Step 3: Export preview & execute ---- */}
      {step === 'export' && (
        <>
          <div className="text-[13px] font-medium text-textColor">
            {t('designer_export_n_files', 'Export {{count}} file', { count: outputCount })}
            {outputCount === 1
              ? ` (${(outputFormats[selectedOutputs[0].id] || 'png').toUpperCase()}${outputFormats[selectedOutputs[0].id] !== 'pdf' ? `, ${scale}x` : ''})`
              : ''}
          </div>

          {outputCount > 1 && (
            <div className="flex flex-wrap gap-1 text-[11px] text-newTextColor/60">
              {selectedOutputs.map((o) => {
                const fmt = outputFormats[o.id] || 'png';
                const preset = CHANNEL_PRESETS.find((p) => p.id === o.formatId);
                return (
                  <span key={o.id} className="bg-newBgColorInner px-2 py-0.5 rounded-[4px]">
                    {preset?.name || o.name}: {fmt.toUpperCase()}
                  </span>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap gap-3 justify-center">
            {loadingPreviews &&
              selectedOutputs.map((_, i) => (
                <div
                  key={i}
                  className="w-[100px] h-[100px] rounded-[6px] bg-newBgColorInner border border-studioBorder animate-pulse flex items-center justify-center"
                >
                  <svg
                    className="animate-spin w-[20px] h-[20px] text-newTextColor/30"
                    viewBox="0 0 24 24"
                    fill="none"
                  >
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray="31.4 31.4"
                    />
                  </svg>
                </div>
              ))}
            {!loadingPreviews &&
              previews.map((p) => (
                <div
                  key={p.idx}
                  className="w-[100px] h-[100px] rounded-[6px] border border-studioBorder overflow-hidden bg-newBgColorInner"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
                  <img
                    src={p.dataUrl}
                    alt={t('designer_output_n_alt', 'Output {{n}}', { n: p.idx + 1 })}
                    className="w-full h-full object-contain"
                  />
                </div>
              ))}
          </div>

          <div className="flex justify-between gap-2 mt-2">
            <button
              onClick={goToFolder}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('back', 'Back')}
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 disabled:opacity-50 transition-all"
            >
              {exporting
                ? t('designer_exporting_ellipsis', 'Exporting...')
                : t('designer_export_n_files', 'Export {{count}} file', { count: outputCount })}
            </button>
          </div>
        </>
      )}

      {/* ---- Step 4: Done ---- */}
      {step === 'done' && (
        <>
          <div className="flex flex-col items-center gap-3 py-4">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="11" fill="#22c55e" stroke="none" />
              <path
                d="M7 12.5l3 3 7-7"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="text-[15px] font-semibold text-textColor">
              {t('designer_saved_to_files', 'Saved to /files')}
            </div>
            <div className="text-[13px] text-newTextColor/60 text-center">
              {selectedFolderId
                ? t('designer_n_files_exported_to_folder', '{{count}} file exported to the selected folder', { count: savedFiles.length })
                : t('designer_n_files_exported', '{{count}} file exported', { count: savedFiles.length })}
            </div>

            {previews.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {previews.map((p) => (
                  <div
                    key={p.idx}
                    className="w-[80px] h-[80px] rounded-[4px] border border-studioBorder overflow-hidden bg-newBgColorInner"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
                    <img
                      src={p.dataUrl}
                      alt={t('designer_output_n_alt', 'Output {{n}}', { n: p.idx + 1 })}
                      className="w-full h-full object-contain"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={onClose}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('close', 'Close')}
            </button>
            <button
              onClick={goToDraftPosts}
              className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 transition-all"
            >
              {t('designer_create_draft_posts', 'Create draft posts')}
            </button>
          </div>
        </>
      )}

      {/* ---- Step 5: Draft Posts ---- */}
      {step === 'draft-posts' && (
        <>
          <div className="text-[15px] font-semibold text-textColor">
            {t('designer_create_draft_posts_title', 'Create Draft Posts')}
          </div>
          <div className="text-[12px] text-newTextColor/60">
            {t('designer_turn_into_drafts_prefix', 'Turn these into draft posts — this will create')}{' '}
            <strong>{confirmedDraftCount}</strong> {t('designer_draft_plural_suffix', 'draft', { count: confirmedDraftCount })}
          </div>

          <div className="max-h-[300px] overflow-y-auto flex flex-col gap-2">
            {draftLoading && (
              <div className="text-[12px] text-newTextColor/60 text-center py-4">
                {t('designer_loading_integrations_ellipsis', 'Loading integrations...')}
              </div>
            )}

            {!draftLoading &&
              draftRows.map((row, idx) => {
                const isSkipped = !row.integration || !row.provider;
                const isUnchecked = !row.checked;

                return (
                  <div
                    key={`${row.outputIdx}-${row.integration?.id || idx}`}
                    className={`flex items-center gap-2 p-2 rounded-[8px] border ${
                      isSkipped
                        ? 'border-studioBorder/30 bg-newBgColorInner/30'
                        : 'border-studioBorder bg-newBgColorInner'
                    } ${
                      isUnchecked && !isSkipped ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={row.checked}
                      disabled={isSkipped}
                      onChange={() => toggleDraftRow(idx)}
                      className="accent-designerAccent w-[14px] h-[14px] flex-shrink-0"
                    />

                    <div className="w-[36px] h-[36px] rounded-[4px] overflow-hidden flex-shrink-0 bg-newBgColor border border-studioBorder/50">
                      {previews[row.outputIdx]?.dataUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data URL preview
                        <img
                          src={previews[row.outputIdx].dataUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-[10px] text-newTextColor/30">
                          #
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-[12px] truncate ${
                          isSkipped ? 'text-newTextColor/60' : 'text-textColor'
                        }`}
                      >
                        {row.output.name || row.output.formatId} → {row.integrationName}
                      </div>

                      {row.missingAlt && !isSkipped && (
                        <div className="mt-1">
                          <span className="text-[10px] text-yellow-500 font-medium">
                            {t('designer_missing_alt_text', 'Missing alt text')}
                          </span>
                          <input
                            type="text"
                            value={row.altText}
                            onChange={(e) => setAltText(idx, e.target.value)}
                            placeholder={t('designer_alt_text_recommended_placeholder', 'Alt text (recommended)...')}
                            className="w-full mt-1 h-[24px] px-[8px] rounded-[4px] bg-newBgColor border border-yellow-500/40 text-[11px] text-textColor outline-none focus:border-yellow-500"
                          />
                        </div>
                      )}

                      {!row.missingAlt && row.altText && !isSkipped && (
                        <div className="text-[10px] text-newTextColor/65 truncate mt-0.5">
                          {t('designer_alt_prefix', 'Alt: {{text}}', { text: row.altText })}
                        </div>
                      )}
                    </div>

                    {row.provider && row.integration && (
                      <ProviderIcon
                        identifier={row.provider}
                        name={row.provider}
                        size={16}
                      />
                    )}
                  </div>
                );
              })}
          </div>

          {!draftLoading && draftRows.length === 0 && (
            <div className="text-[12px] text-newTextColor/60 text-center py-4">
              {t('designer_no_outputs_to_create_drafts_for', 'No outputs to create drafts for')}
            </div>
          )}

          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={onClose}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('designer_skip_slash_done', 'Skip / Done')}
            </button>
            <button
              onClick={handleCreateDraftPosts}
              disabled={confirmedDraftCount === 0 || draftCreating}
              className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 disabled:opacity-50 transition-all"
            >
              {draftCreating
                ? t('designer_creating_ellipsis', 'Creating...')
                : t('designer_create_n_drafts', 'Create {{count}} draft', { count: confirmedDraftCount })}
            </button>
          </div>
        </>
      )}

      {/* ---- Step 6: Video Render Options ---- */}
      {step === 'video-render' && (
        <>
          <div className="text-[15px] font-semibold text-textColor">{t('designer_render_video_title', 'Render Video')}</div>
          <div className="text-[12px] text-newTextColor/60">
            {t('designer_render_composition_description', 'Render composition as video via the server render pipeline.')}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-medium text-textColor">{t('designer_format_label', 'Format')}</div>
              <div className="flex gap-2">
                {(['mp4', 'webm', 'gif', 'webp-animated'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setVideoFormat(f)}
                    className={`flex-1 h-[36px] rounded-[6px] text-[13px] font-medium transition-all ${
                      videoFormat === f
                        ? 'bg-designerAccent text-white'
                        : 'border border-studioBorder text-textColor hover:bg-boxHover'
                    }`}
                  >
                    {f === 'webp-animated' ? 'WebP' : f.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-medium text-textColor">{t('designer_quality_label', 'Quality')}</div>
              <div className="flex gap-2">
                {(['low', 'medium', 'high'] as const).map((q) => (
                  <button
                    key={q}
                    onClick={() => setVideoQuality(q)}
                    className={`flex-1 h-[36px] rounded-[6px] text-[13px] font-medium capitalize transition-all ${
                      videoQuality === q
                        ? 'bg-designerAccent text-white'
                        : 'border border-studioBorder text-textColor hover:bg-boxHover'
                    }`}
                  >
                    {q === 'low'
                      ? t('designer_quality_low', 'low')
                      : q === 'medium'
                        ? t('designer_quality_medium', 'medium')
                        : t('designer_quality_high', 'high')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-medium text-textColor">{t('designer_bitrate_label', 'Bitrate')}</div>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={1000}
                  max={20000}
                  step={500}
                  value={videoBitrateKbps}
                  onChange={(e) => setVideoBitrateKbps(parseInt(e.target.value, 10))}
                  className="flex-1 accent-designerAccent"
                />
                <span className="text-[12px] text-textColor tabular-nums w-20 text-right">
                  {videoBitrateKbps} kbps
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <div className="text-[13px] font-medium text-textColor">{t('designer_poster_thumbnail_label', 'Poster / Thumbnail')}</div>
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  accept="image/*"
                  disabled={posterUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setPosterUploading(true);
                    try {
                      const formData = new FormData();
                      formData.append('file', file);
                      if (selectedFolderId) formData.append('folderId', selectedFolderId);
                      const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
                      if (res.ok) {
                        const data = await res.json();
                        setPosterSource('custom');
                        setPosterUrl(data.path);
                      } else {
                        toaster.show(t('designer_poster_upload_failed', 'Poster upload failed'), 'warning');
                      }
                    } catch {
                      toaster.show(t('designer_poster_upload_failed', 'Poster upload failed'), 'warning');
                    } finally {
                      setPosterUploading(false);
                    }
                  }}
                  className="text-[12px] text-textColor file:mr-2 file:px-2 file:py-1 file:rounded file:border-0 file:bg-designerAccent file:text-white"
                />
                {posterUrl && (
                  <button
                    onClick={() => setPosterUrl('')}
                    className="text-[11px] text-dangerText hover:text-red-300"
                  >
                    {t('clear', 'Clear')}
                  </button>
                )}
              </div>
              {posterUrl && (
                <div className="text-[10px] text-newTextColor/65 truncate">{posterUrl}</div>
              )}
            </div>

            <div className="text-[11px] text-newTextColor/65 mt-1">
              {t('designer_video_renders_async_description', 'Video renders are processed asynchronously. You can check progress on this screen after starting.')}
            </div>
          </div>

          <div className="flex justify-between gap-2 mt-2">
            <button
              onClick={goToFolder}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('back', 'Back')}
            </button>
            <button
              onClick={startVideoRender}
              disabled={isEnqueuing}
              className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 disabled:opacity-50 transition-all"
            >
              {isEnqueuing ? t('designer_enqueuing_ellipsis', 'Enqueuing...') : t('designer_start_render', 'Start Render')}
            </button>
          </div>

          {renderError && (
            <div className="text-[12px] text-dangerText mt-2">{renderError}</div>
          )}
        </>
      )}

      {/* ---- Step 7: Video Rendering (polling) ---- */}
      {step === 'video-rendering' && (
        <>
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="text-[15px] font-semibold text-textColor">{t('designer_rendering_video_title', 'Rendering Video')}</div>

            {renderStatus === 'rendering' && (
              <>
                <div className="w-full">
                  <div className="flex justify-between text-[12px] text-newTextColor/60 mb-1">
                    <span>{t('designer_processing_ellipsis', 'Processing...')}</span>
                    <span>{renderProgress}%</span>
                  </div>
                  <div className="w-full h-[8px] rounded-[4px] bg-newBgColorInner border border-studioBorder overflow-hidden">
                    <div
                      className="h-full bg-designerAccent transition-all duration-500 rounded-[4px]"
                      style={{ width: `${Math.max(renderProgress, 5)}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 text-[13px] text-newTextColor/60">
                  <svg className="animate-spin w-[16px] h-[16px]" viewBox="0 0 24 24" fill="none">
                    <circle
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeDasharray="31.4 31.4"
                    />
                  </svg>
                  {t('designer_processing_video_render_ellipsis', 'Processing video render...')}
                </div>
              </>
            )}

            {renderStatus === 'completed' && (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="#22c55e" stroke="none" />
                  <path d="M7 12.5l3 3 7-7" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <div className="text-[14px] text-textColor font-medium">{t('designer_render_complete', 'Render Complete')}</div>
                <div className="w-full flex flex-col gap-1">
                  {renderJobs.filter((j) => j.status === 'completed' && j.artifactUrl).map((j) => (
                    <a
                      key={j.id}
                      href={j.artifactUrl || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12px] text-btnPrimaryAccent hover:underline truncate"
                    >
                      {j.outputName}
                    </a>
                  ))}
                </div>

                {renderedPosterUrl && (
                  <div className="w-full flex flex-col gap-2 mt-1">
                    <div className="text-[13px] font-medium text-textColor">{t('designer_poster_thumbnail_label', 'Poster / Thumbnail')}</div>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        className={`w-[80px] h-[80px] rounded-[6px] border overflow-hidden cursor-pointer p-0 bg-transparent ${posterSource === 'rendered' ? 'border-designerAccent ring-2 ring-designerAccent/30' : 'border-studioBorder'}`}
                        onClick={() => {
                          setPosterSource('rendered');
                          setPosterUrl(renderedPosterUrl);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- data URL preview */}
                        <img
                          src={renderedPosterUrl}
                          alt={t('designer_rendered_poster_alt', 'Rendered poster')}
                          className="w-full h-full object-cover"
                        />
                      </button>
                      <div className="flex flex-col gap-1">
                        <button
                          onClick={() => {
                            setPosterSource('rendered');
                            setPosterUrl(renderedPosterUrl);
                          }}
                          className={`text-[12px] px-3 py-1.5 rounded-[5px] transition-all ${
                            posterSource === 'rendered'
                              ? 'bg-designerAccent text-white'
                              : 'border border-studioBorder text-textColor hover:bg-boxHover'
                          }`}
                        >
                          {t('designer_use_rendered_poster', 'Use rendered poster')}
                        </button>
                        <label
                          className={`text-[12px] px-3 py-1.5 rounded-[5px] cursor-pointer transition-all ${
                            posterSource === 'custom'
                              ? 'bg-designerAccent text-white'
                              : 'border border-studioBorder text-textColor hover:bg-boxHover'
                          }`}
                        >
                          <input
                            type="file"
                            accept="image/*"
                            disabled={posterUploading}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              if (!file) return;
                              setPosterUploading(true);
                              try {
                                const formData = new FormData();
                                formData.append('file', file);
                                if (selectedFolderId) formData.append('folderId', selectedFolderId);
                                const res = await fetch('/files/upload-simple', { method: 'POST', body: formData });
                                if (res.ok) {
                                  const data = await res.json();
                                  setPosterSource('custom');
                                  setPosterUrl(data.path);
                                } else {
                                  toaster.show(t('designer_poster_upload_failed', 'Poster upload failed'), 'warning');
                                }
                              } catch {
                                toaster.show(t('designer_poster_upload_failed', 'Poster upload failed'), 'warning');
                              } finally {
                                setPosterUploading(false);
                              }
                            }}
                            className="hidden"
                          />
                          {posterUploading ? t('designer_uploading_ellipsis', 'Uploading...') : t('designer_upload_custom', 'Upload custom')}
                        </label>
                      </div>
                    </div>
                    {posterUrl && (
                      <div className="text-[10px] text-newTextColor/65 truncate">{posterUrl}</div>
                    )}
                  </div>
                )}
              </>
            )}

            {renderStatus === 'failed' && (
              <>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="11" fill="#ef4444" stroke="none" />
                  <path d="M8 8l8 8M16 8l-8 8" stroke="white" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <div className="text-[14px] text-dangerText font-medium">{t('designer_render_failed_title', 'Render Failed')}</div>
                {renderError && (
                  <div className="text-[12px] text-newTextColor/60 text-center">{renderError}</div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-between gap-2 mt-2">
            <button
              onClick={() => {
                setStep('video-render');
                setRenderJobs([]);
              }}
              className="px-4 h-[38px] rounded-[6px] border border-studioBorder text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              {t('back', 'Back')}
            </button>
            {renderStatus === 'completed' && (
              <button
                onClick={handleVideoDone}
                className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 transition-all"
              >
                {t('done', 'Done')}
              </button>
            )}
            {renderStatus === 'failed' && (
              <button
                onClick={startVideoRender}
                className="px-4 h-[38px] rounded-[6px] bg-green-600 text-white text-[13px] font-medium hover:bg-green-700 transition-all"
              >
                {t('retry', 'Retry')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
