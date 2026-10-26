'use client';

import React, { FC, useCallback, useMemo, useRef, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useMediaToolsStatus } from '@postmill-ai/frontend/components/layout/use-media-tools-status';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import {
  GenerationProviderPicker,
  useGenerationProviderChoice,
} from '@postmill-ai/frontend/components/media-tools/designer/panels/generation-provider-picker';
import {
  CompactStudio,
  type CompactStudioResult,
} from '@postmill-ai/frontend/components/media-tools/studio-kit/compact-studio';
import { addImageClipToTimeline } from '@postmill-ai/frontend/components/media-tools/designer/add-media-to-timeline';
import { closestAspectRatio } from '@postmill-ai/frontend/components/media-tools/replicate/aspect-ratio';

interface AiPanelProps {
  store: any;
  /** Set when hosted in a modal, so adding an image dismisses it. */
  onClose?: () => void;
}

interface GeneratedImage {
  id: string;
  path: string;
  name: string;
}

// Explicit lifecycle states for an AI generation request (C7).
type GenStatus = 'idle' | 'queued' | 'generating' | 'failed';

export const AiPanel: FC<AiPanelProps> = ({ store, onClose }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { toolAvailable } = useMediaToolsStatus();
  const textToImageAvailable = toolAvailable('text-to-image');

  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<GenStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  // '' = org default provider (the legacy path below); an explicit provider
  // embeds its compact studio, which owns generation instead.
  const [provider, setProvider] = useGenerationProviderChoice('image');
  // The canvas's aspect seeds a studio schema's aspect_ratio field (never
  // overriding an explicit Advanced-settings pick — see CompactReplicate).
  const canvasAspect = useMemo(() => {
    const state = store.getState();
    const out = state.doc.outputs[state.currentOutput];
    return closestAspectRatio(out?.width, out?.height);
  }, [store]);

  const inFlight = status === 'queued' || status === 'generating';

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || inFlight || !textToImageAvailable) return;
    setErrorMessage('');
    setStatus('queued');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Brief queued → generating transition so the user sees the request was accepted.
      setStatus('generating');
      const res = await fetch('/media/generate-image-with-prompt', {
        method: 'POST',
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setStatus('failed');
        setErrorMessage(t('ai_panel_generation_failed_retry', 'Image generation failed. Please try again.'));
        return;
      }
      const data = (await res.json()) as GeneratedImage | false;
      if (!data) {
        // Credit-blocked or empty generation.
        setStatus('failed');
        setErrorMessage(t('ai_panel_generation_blocked_empty', 'Image generation was blocked or returned empty.'));
        return;
      }
      setResults((prev) => [data, ...prev]);
      setStatus('idle');
      toaster.show(t('ai_panel_image_generated', 'Image generated'), 'success');
    } catch (e) {
      // Aborts are user-initiated cancels — return to idle silently.
      if (controller.signal.aborted) {
        setStatus('idle');
        return;
      }
      setStatus('failed');
      setErrorMessage(t('ai_panel_generation_failed_retry_short', 'Generation failed. Please try again.'));
    } finally {
      abortRef.current = null;
    }
  }, [prompt, fetch, toaster, inFlight, textToImageAvailable, t]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStatus('idle');
    toaster.show(t('ai_panel_generation_cancelled', 'Generation cancelled'), 'success');
  }, [toaster, t]);

  const handleAddToCanvas = useCallback(
    (item: GeneratedImage) => {
      const img = new Image();
      img.onload = () => {
        const state = store.getState();
        const out = state.doc.outputs[state.currentOutput];
        const naturalWidth = img.naturalWidth || out.width;
        const naturalHeight = img.naturalHeight || out.height;

        // addElement is a silent no-op in video mode (designer.store.ts) —
        // land the image as a timeline clip instead, or the success toast
        // would lie (prod: completed job, design JSON unchanged, no clip).
        if (state.doc.mode === 'video') {
          const clipId = addImageClipToTimeline(store, {
            url: item.path,
            fileId: item.id,
            width: naturalWidth,
            height: naturalHeight,
          });
          if (!clipId) {
            toaster.show(
              t('ai_panel_could_not_add_to_timeline', 'Could not add the image to the timeline'),
              'warning'
            );
            return;
          }
          toaster.show(t('ai_panel_image_added_to_timeline', 'Image added to timeline'), 'success');
          onClose?.();
          return;
        }

        const maxW = out.width * 0.9;
        const maxH = out.height * 0.9;
        const scale = Math.min(1, maxW / naturalWidth, maxH / naturalHeight);
        const width = naturalWidth * scale;
        const height = naturalHeight * scale;

        state.addElement({
          id: '',
          type: 'image',
          src: item.path,
          fileId: item.id,
          x: (out.width - width) / 2,
          y: (out.height - height) / 2,
          width,
          height,
          rotation: 0,
          opacity: 1,
          locked: false,
          hidden: false,
          naturalWidth,
          naturalHeight,
        });
        toaster.show(t('ai_panel_image_added_to_canvas', 'Image added to canvas'), 'success');
        onClose?.();
      };
      img.onerror = () => {
        toaster.show(t('ai_panel_could_not_load_generated_image', 'Could not load generated image'), 'warning');
      };
      img.src = item.path;
    },
    [store, toaster, t, onClose]
  );

  const handleStudioGenerated = useCallback(
    (result: CompactStudioResult) => {
      // Land exactly like a legacy result: centered/scaled via handleAddToCanvas
      // (which also dismisses the hosting modal through onClose).
      handleAddToCanvas({
        id: result.fileId,
        path: result.artifactUrl,
        name: result.artifactUrl.split('/').pop() || 'AI image',
      });
    },
    [handleAddToCanvas]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey && !provider) {
        e.preventDefault();
        handleGenerate();
      }
    },
    [handleGenerate, provider]
  );

  if (!textToImageAvailable) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        <div className="text-[12px] text-newTextColor/60">
          {t('ai_panel_configure_provider', 'Configure an image-generation provider in Settings → Content → Media Defaults to use the AI panel.')}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('ai_panel_describe_image_placeholder', 'Describe the image...')}
          className="flex-1 h-[36px] px-[10px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-hidden focus:border-designerAccent"
        />
        {!provider &&
          (inFlight ? (
            <button
              onClick={handleCancel}
              className="px-[12px] h-[36px] rounded-[6px] border border-studioBorder text-textColor text-[13px] font-medium hover:bg-boxHover shrink-0"
            >
              {t('cancel', 'Cancel')}
            </button>
          ) : (
            <button
              onClick={handleGenerate}
              disabled={!prompt.trim()}
              className="px-[12px] h-[36px] rounded-[6px] bg-designerAccent text-white text-[13px] font-medium hover:bg-designerAccent/80 disabled:opacity-50 shrink-0"
            >
              {t('generate', 'Generate')}
            </button>
          ))}
      </div>

      <GenerationProviderPicker
        operation="image"
        dialogKey="image"
        value={provider}
        onChange={setProvider}
      />

      {provider && (
        // key: remount on provider switch so the previous provider's field
        // values (model!) can't leak into the new provider's submit.
        <CompactStudio
          key={provider}
          provider={provider}
          operation="image"
          prompt={prompt}
          aspectRatio={canvasAspect}
          onGenerated={handleStudioGenerated}
        />
      )}

      {status === 'queued' && (
        <div className="flex items-center justify-center gap-2 py-6 text-newTextColor/65 text-[13px]">
          <span
            className="w-[10px] h-[10px] rounded-full bg-[#EAB308] motion-safe:animate-pulse"
            aria-hidden="true"
          />
          {t('ai_panel_queued', 'Queued…')}
        </div>
      )}

      {status === 'generating' && (
        <div className="flex items-center justify-center gap-2 py-6 text-newTextColor/65 text-[13px]">
          <span
            className="w-[14px] h-[14px] rounded-full border-2 border-studioBorder border-t-designerAccent motion-safe:animate-spin"
            aria-hidden="true"
          />
          {t('ai_panel_generating', 'Generating…')}
        </div>
      )}

      {status === 'failed' && (
        <div
          className="flex flex-col items-center gap-2 py-5 text-center"
          role="alert"
        >
          <div className="text-[20px] text-newTextColor/30" aria-hidden="true">
            ⚠
          </div>
          <div className="text-[12px] text-newTextColor/60">
            {errorMessage || t('ai_panel_generation_failed', 'Generation failed.')}
          </div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!prompt.trim()}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-studioBorder text-textColor hover:border-designerAccent hover:bg-boxHover transition-colors disabled:opacity-50"
          >
            {t('try_again', 'Try again')}
          </button>
        </div>
      )}

      {results.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {results.map((item) => (
            <button
              key={item.id}
              onClick={() => handleAddToCanvas(item)}
              className="relative group rounded-[6px] overflow-hidden border border-studioBorder hover:border-designerAccent transition-all"
              title={t('ai_panel_click_to_add_to_canvas', 'Click to add to canvas')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
              <img
                src={item.path}
                alt={item.name}
                className="w-full aspect-square object-cover"
              />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center">
                <span className="text-white text-[12px] font-medium opacity-0 group-hover:opacity-100 transition-all">
                  {t('ai_panel_add_to_canvas', 'Add to Canvas')}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
