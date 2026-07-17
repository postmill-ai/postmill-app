'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { FullscreenButton } from '@gitroom/frontend/components/media-tools/fullscreen-button';
import { useFullscreen } from '@gitroom/frontend/components/media-tools/use-fullscreen';
import {
  MediaSelectorModal,
  type MediaSelectorItem,
} from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useBrands } from '@gitroom/frontend/components/settings/brand/use-brands';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { SafeContent } from '@gitroom/frontend/components/shared/safe-content';
import { useImportStockMedia } from './ai-designer.hooks';
import { markdownToHtml } from './markdown-lite';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import type {
  AiDesignerConfig,
  AiDesignerMode,
  AiDesignerStartPayload,
} from '@gitroom/nestjs-libraries/ai-designer/ai-designer.types';

interface AiDesignerStartProps {
  onStart: (
    payload: Omit<AiDesignerStartPayload, 'nonce'> & { mode: AiDesignerMode }
  ) => void;
  isStarting?: boolean;
  /** Socket connection state — Start is disabled until the socket is up. */
  isConnected?: boolean;
  /** Manual reconnect trigger for when auto-retries are exhausted. */
  onReconnect?: () => void;
  /** Markdown guidance from the server (e.g. missing model defaults). */
  notice?: string | null;
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const NoticeContent: React.FC<{ notice: string }> = ({ notice }) => {
  const html = useMemo(() => markdownToHtml(notice), [notice]);
  return (
    <SafeContent
      content={html}
      className="space-y-2 [&_a]:text-btnPrimaryAccent [&_a]:underline"
    />
  );
};

export const AiDesignerStart: React.FC<AiDesignerStartProps> = ({
  onStart,
  isStarting = false,
  isConnected = true,
  onReconnect,
  notice,
}) => {
  const toaster = useToaster();
  const t = useT();
  const { data: brands } = useBrands();
  const { isFullscreen } = useFullscreen();
  const [mode, setMode] = useState<AiDesignerMode>('chat');
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [customSizes, setCustomSizes] = useState<
    { id: string; width: number; height: number }[]
  >([]);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [savePath, setSavePath] = useState('');
  const [brandProfileId, setBrandProfileId] = useState('');
  const [variants, setVariants] = useState(3);
  const [referenceItems, setReferenceItems] = useState<MediaSelectorItem[]>([]);
  const [referenceImporting, setReferenceImporting] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [prompt, setPrompt] = useState('');
  const importStockMedia = useImportStockMedia();

  const imagePresets = useMemo(
    () => CHANNEL_PRESETS.filter((p) => p.category !== 'video'),
    []
  );

  const toggleChannel = (id: string) => {
    setSelectedChannels((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const addCustomSize = () => {
    const w = parseInt(customW, 10);
    const h = parseInt(customH, 10);
    if (w > 0 && h > 0) {
      setCustomSizes((prev) => [...prev, { id: makeId(), width: w, height: h }]);
      setCustomW('');
      setCustomH('');
    }
  };

  const removeCustomSize = (id: string) => {
    setCustomSizes((prev) => prev.filter((s) => s.id !== id));
  };

  const mergeReferenceItems = (
    prev: MediaSelectorItem[],
    next: MediaSelectorItem[]
  ) => {
    const map = new Map<string, MediaSelectorItem>();
    for (const item of prev) map.set(`${item.source}-${item.url}`, item);
    for (const item of next) map.set(`${item.source}-${item.url}`, item);
    return Array.from(map.values());
  };

  const handleStart = () => {
    if (selectedChannels.length === 0 && customSizes.length === 0) {
      toaster.show(
        t(
          'select_at_least_one_channel_or_custom_size',
          'Select at least one channel or custom size'
        ),
        'warning'
      );
      return;
    }
    if (mode === 'prompt' && !prompt.trim()) {
      toaster.show(t('enter_a_prompt_to_start', 'Enter a prompt to start'), 'warning');
      return;
    }

    const config: AiDesignerConfig = {
      channels: selectedChannels,
      customSizes:
        customSizes.length > 0
          ? customSizes.map(({ width, height }) => ({
              width,
              height,
              name: `${width}×${height}`,
            }))
          : undefined,
      savePath: savePath.trim() || undefined,
      brandProfileId: brandProfileId || undefined,
      variants,
      referenceFileIds:
        referenceItems.length > 0
          ? referenceItems
              .map((item) => item.fileId)
              .filter(Boolean) as string[]
          : undefined,
    };

    onStart({
      mode,
      config,
      prompt: prompt.trim() || undefined,
    });
  };

  return (
    <div
      className={`flex flex-col h-full bg-studioBg${
        isFullscreen ? ' fixed inset-0 z-[100]' : ' rounded-[12px] overflow-hidden'
      }`}
    >
      <div className="flex items-center justify-between gap-[10px] px-[16px] h-[52px] border-b border-studioBorder shrink-0">
        <div className="flex items-center gap-[10px] shrink-0">
          <Logo size={22} className="" />
          <h1 className="text-[15px] font-[600] text-textColor whitespace-nowrap">
            {t('ai_designer', 'AI Designer')}
          </h1>
        </div>
        <FullscreenButton />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[20px]">
        <div className="max-w-3xl mx-auto space-y-6">
          {notice && (
            <div className="rounded-lg border border-amber-600/40 bg-amber-600/10 p-3 text-[13px] text-amber-800 dark:text-amber-400">
              <NoticeContent notice={notice} />
            </div>
          )}

          {/* Mode selector */}
          <div className="flex items-center gap-2 p-1 rounded-lg border border-studioBorder bg-newBgColorInner w-fit">
            {(['chat', 'prompt'] as AiDesignerMode[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 rounded-md text-[13px] font-medium transition-colors ${
                  mode === m
                    ? 'bg-designerAccent/20 text-textColor'
                    : 'text-textColor/60 hover:text-textColor'
                }`}
              >
                {m === 'chat' ? t('chat', 'Chat') : t('prompt', 'Prompt')}
              </button>
            ))}
          </div>

          {/* Channels */}
          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-textColor">
              {t('channels_formats', 'Channels / formats')}
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {imagePresets.map((preset) => {
                const active = selectedChannels.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => toggleChannel(preset.id)}
                    className={`flex flex-col items-start gap-1 p-3 rounded-xl border text-left transition-colors ${
                      active
                        ? 'border-designerAccent bg-designerAccent/10'
                        : 'border-studioBorder hover:border-designerAccent/60 hover:bg-boxHover'
                    }`}
                  >
                    <span className="text-[13px] font-medium text-textColor">
                      {preset.name}
                    </span>
                    <span className="text-[11px] text-textColor/50 tabular-nums">
                      {preset.width} × {preset.height}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Custom sizes */}
          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-textColor">
              {t('custom_sizes', 'Custom sizes')}
            </h2>
            <div className="flex items-center gap-2">
              <label htmlFor="custom-width" className="sr-only">
                {t('custom_width', 'Custom width')}
              </label>
              <input
                id="custom-width"
                type="number"
                value={customW}
                onChange={(e) => setCustomW(e.target.value)}
                placeholder={t('width_abbreviation', 'W')}
                className="w-24 h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor text-center outline-none focus:border-designerAccent"
              />
              <span className="text-textColor/40">×</span>
              <label htmlFor="custom-height" className="sr-only">
                {t('custom_height', 'Custom height')}
              </label>
              <input
                id="custom-height"
                type="number"
                value={customH}
                onChange={(e) => setCustomH(e.target.value)}
                placeholder={t('height_abbreviation', 'H')}
                className="w-24 h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor text-center outline-none focus:border-designerAccent"
              />
              <Button
                type="button"
                secondary
                onClick={addCustomSize}
                disabled={!customW || !customH}
              >
                {t('add', 'Add')}
              </Button>
            </div>
            {customSizes.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customSizes.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-2 px-2 py-1 rounded-lg border border-studioBorder bg-newBgColorInner text-[12px] text-textColor"
                  >
                    {s.width} × {s.height}
                    <button
                      type="button"
                      onClick={() => removeCustomSize(s.id)}
                      className="text-textColor/50 hover:text-dangerText"
                      aria-label={t('remove_custom_size', 'Remove custom size')}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Save path & brand */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('save_path_folder', 'Save path / folder')}
              name="savePath"
              disableForm
              value={savePath}
              onChange={(e) => setSavePath(e.target.value)}
              placeholder={t(
                'save_path_placeholder_example',
                'e.g. /campaigns/summer-launch'
              )}
            />

            <div className="flex flex-col gap-[6px]">
              <label htmlFor="brandProfileId" className="text-[14px] text-textColor">
                {t('brand_profile', 'Brand profile')}
              </label>
              <select
                id="brandProfileId"
                value={brandProfileId}
                onChange={(e) => setBrandProfileId(e.target.value)}
                className="h-[42px] rounded-[8px] border border-studioBorder bg-newBgColorInner px-[16px] text-[14px] text-textColor outline-none focus:border-designerAccent"
              >
                <option value="">{t('none', 'None')}</option>
                {brands?.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* Variants */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label={t('variants', 'Variants')}
              name="variants"
              aria-label={t('variants', 'Variants')}
              type="number"
              disableForm
              min={1}
              max={10}
              value={variants}
              onChange={(e) => {
                // Clamp to 1..10 — clearing the input must not produce 0.
                const n = Number(e.target.value);
                setVariants(
                  Number.isFinite(n) && n > 0
                    ? Math.min(10, Math.max(1, Math.round(n)))
                    : 1
                );
              }}
            />
          </section>

          {/* Reference images */}
          <section className="space-y-3">
            <h2 className="text-[14px] font-semibold text-textColor">
              {t('reference_images', 'Reference images')}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                secondary
                onClick={() => setShowMediaPicker(true)}
                disabled={referenceImporting}
              >
                {referenceImporting
                  ? t('importing_ellipsis', 'Importing…')
                  : t('add_reference', 'Add reference')}
              </Button>
              {referenceImporting && (
                <span className="text-[12px] text-textColor/50">
                  {t('importing_stock_reference_ellipsis', 'Importing stock reference…')}
                </span>
              )}
              {referenceItems.map((item) => (
                <div
                  key={`${item.source}-${item.url}`}
                  className="flex items-center gap-2 px-2 py-1 rounded-lg border border-studioBorder bg-newBgColorInner text-[12px] text-textColor"
                >
                  {item.thumbnail || item.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={item.thumbnail || item.url}
                      alt=""
                      className="w-5 h-5 rounded object-cover"
                    />
                  ) : null}
                  <span className="truncate max-w-[120px]">
                    {item.name || t('reference', 'Reference')}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setReferenceItems((prev) =>
                        prev.filter(
                          (p) => !(p.source === item.source && p.url === item.url)
                        )
                      )
                    }
                    className="text-textColor/50 hover:text-dangerText"
                    aria-label={t('remove_reference', 'Remove reference')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Prompt (prompt mode) */}
          {mode === 'prompt' && (
            <section className="space-y-2">
              <label
                htmlFor="ai-designer-prompt"
                className="block text-[14px] font-semibold text-textColor"
              >
                {t('prompt', 'Prompt')}
              </label>
              <textarea
                id="ai-designer-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  'describe_the_design_you_want_ellipsis',
                  'Describe the design you want…'
                )}
                rows={4}
                className="w-full rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-none focus:border-designerAccent resize-none"
              />
            </section>
          )}

          <div className="pt-2 flex items-center gap-2">
            <Button
              type="button"
              loading={isStarting}
              onClick={handleStart}
              disabled={
                (selectedChannels.length === 0 && customSizes.length === 0) ||
                isStarting ||
                !isConnected ||
                referenceImporting
              }
            >
              {isConnected
                ? t('start_designing', 'Start designing')
                : t('connecting_ellipsis', 'Connecting…')}
            </Button>
            {!isConnected && onReconnect && (
              <Button type="button" secondary onClick={onReconnect}>
                {t('retry', 'Retry')}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showMediaPicker && (
        <MediaSelectorModal
          open
          onClose={() => setShowMediaPicker(false)}
          kinds={['image']}
          multiple
          onConfirm={async (items) => {
            setShowMediaPicker(false);
            const stockItems = items.filter(
              (item) => item.source === 'stock' || !item.fileId
            );
            const fileItems = items.filter(
              (item) => item.source === 'file' && item.fileId
            );
            setReferenceItems((prev) => mergeReferenceItems(prev, fileItems));
            if (stockItems.length === 0) return;

            setReferenceImporting(true);
            try {
              const imported = await Promise.all(
                stockItems.map((item) => importStockMedia(item))
              );
              setReferenceItems((prev) =>
                mergeReferenceItems(prev, imported)
              );
            } catch (e) {
              toaster.show(
                (e as Error).message ||
                  t('failed_to_import_reference_image', 'Failed to import reference image'),
                'warning'
              );
            } finally {
              setReferenceImporting(false);
            }
          }}
        />
      )}
    </div>
  );
};
