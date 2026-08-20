'use client';

import React, { useMemo, useState } from 'react';
import { Button } from '@postmill-ai/react/form/button';
import { Input } from '@postmill-ai/react/form/input';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Logo } from '@postmill-ai/frontend/components/new-layout/logo';
import { FullscreenButton } from '@postmill-ai/frontend/components/media-tools/fullscreen-button';
import { useFullscreenSurface } from '@postmill-ai/frontend/components/media-tools/use-fullscreen';
import { type MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import { useBrands } from '@postmill-ai/frontend/components/settings/brand/use-brands';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import {
  FolderPickerDialog,
  useFolderName,
} from '@postmill-ai/frontend/components/files/folder-picker';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { SafeContent } from '@postmill-ai/frontend/components/shared/safe-content';
import { useImportStockMedia } from './ai-designer.hooks';
import { markdownToHtml } from './markdown-lite';
import { PlatformIcon } from '@postmill-ai/frontend/components/shared/platform-icon';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import { listStylePresets } from '@postmill-ai/nestjs-libraries/ai-designer/styles';
import type {
  AiDesignerConfig,
  AiDesignerMode,
  AiDesignerStartPayload,
} from '@postmill-ai/nestjs-libraries/ai-designer/ai-designer.types';

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
  /** Opens the previous-sessions drawer (owned by the page). */
  onOpenSessions?: () => void;
}

const makeId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Same direct-import pattern as CHANNEL_PRESETS above: the style registry is a
// pure data module (no backend-only deps), so the frontend reads it straight
// from nestjs-libraries instead of mirroring the 8 presets.
const STYLE_PRESETS = listStylePresets();

// Mirrors the server bounds in ai-designer.schemas.ts.
const MIN_CUSTOM_SIZE = 16;
const MAX_CUSTOM_SIZE = 4096;

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
  onOpenSessions,
}) => {
  const toaster = useToaster();
  const t = useT();
  const modals = useModals();
  const { data: brands } = useBrands();
  const surface = useFullscreenSurface('rounded-[12px] overflow-hidden');
  const [mode, setMode] = useState<AiDesignerMode>('chat');
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [customSizes, setCustomSizes] = useState<
    { id: string; width: number; height: number }[]
  >([]);
  const [customW, setCustomW] = useState('');
  const [customH, setCustomH] = useState('');
  const [showCustomSizes, setShowCustomSizes] = useState(false);
  // The conductor prefers saveFolderId over the legacy savePath string, so the
  // picker sets the id and savePath stays unset.
  const [saveFolderId, setSaveFolderId] = useState<string | null>(null);
  const saveFolderName = useFolderName(saveFolderId);
  const [brandProfileId, setBrandProfileId] = useState('');
  const [styleId, setStyleId] = useState('');
  const [variants, setVariants] = useState(3);
  const [referenceItems, setReferenceItems] = useState<MediaSelectorItem[]>([]);
  const [referenceImporting, setReferenceImporting] = useState(false);
  // No `requireFile` here: this screen imports the batch itself so it can keep
  // the file/stock split and its own "importing" state. Adding it would import twice.
  const referencePicker = useMediaPicker({
    title: t('reference_images', 'Reference images'),
    kinds: ['image'],
    multiple: true,
    onConfirm: async (items) => {
      referencePicker.close();
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
        setReferenceItems((prev) => mergeReferenceItems(prev, imported));
      } catch (e) {
        toaster.show(
          (e as Error).message ||
            t('failed_to_import_reference_image', 'Failed to import reference image'),
          'warning'
        );
      } finally {
        setReferenceImporting(false);
      }
    },
  });
  const [prompt, setPrompt] = useState('');
  const importStockMedia = useImportStockMedia();

  // `custom` is excluded: it isn't a size, it's the toggle for the custom-size
  // panel (mirrors designer/start-dialog.tsx). Selecting it as a preset used to
  // silently add a hardcoded 1080×1080 duplicate of Instagram Post.
  const imagePresets = useMemo(
    () =>
      CHANNEL_PRESETS.filter(
        (p) => p.category !== 'video' && p.category !== 'custom'
      ),
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
    if (!(w > 0 && h > 0)) return;
    // Match the server bounds (ai-designer.schemas.ts) — out-of-range values
    // used to pass the client and get rejected over the socket with no context.
    if (w < MIN_CUSTOM_SIZE || w > MAX_CUSTOM_SIZE || h < MIN_CUSTOM_SIZE || h > MAX_CUSTOM_SIZE) {
      toaster.show(
        t('custom_size_out_of_range', 'Sizes must be between {{min}} and {{max}} pixels', {
          min: MIN_CUSTOM_SIZE,
          max: MAX_CUSTOM_SIZE,
        }),
        'warning'
      );
      return;
    }
    // Two identical custom sizes collapse to ONE output server-side: the
    // format id is `custom-${width}x${height}`, so the duplicate resolves to
    // the same target and the second entry is silently unreachable.
    if (customSizes.some((s) => s.width === w && s.height === h)) {
      toaster.show(
        t('custom_size_already_added', 'That custom size is already added'),
        'warning'
      );
      setCustomW('');
      setCustomH('');
      return;
    }
    setCustomSizes((prev) => [...prev, { id: makeId(), width: w, height: h }]);
    setCustomW('');
    setCustomH('');
  };

  const removeCustomSize = (id: string) => {
    setCustomSizes((prev) => prev.filter((s) => s.id !== id));
  };

  const openFolderPicker = () => {
    modals.openModal({
      title: t('save_to_folder', 'Save to folder'),
      closeOnClickOutside: true,
      closeOnEscape: true,
      withCloseButton: true,
      center: true,
      children: (close) => (
        <FolderPickerDialog
          initialFolderId={saveFolderId}
          onConfirm={setSaveFolderId}
          onClose={close}
        />
      ),
    });
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
      saveFolderId: saveFolderId || undefined,
      brandProfileId: brandProfileId || undefined,
      styleId: styleId || undefined,
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
      className={`flex flex-col h-full bg-studioBg ${surface}`}
    >
      <div className="flex items-center justify-between gap-[10px] px-[16px] h-[52px] border-b border-studioBorder shrink-0">
        <div className="flex items-center gap-[10px] shrink-0">
          <Logo size={22} className="" />
          <h1 className="text-[15px] font-[600] text-textColor whitespace-nowrap">
            {t('ai_designer', 'AI Designer')}
          </h1>
        </div>
        <div className="flex items-center gap-[8px] shrink-0">
          {onOpenSessions && (
            <Button type="button" secondary onClick={onOpenSessions}>
              {t('previous_sessions', 'Previous sessions')}
            </Button>
          )}
          <FullscreenButton />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-[20px]">
        <div className="max-w-3xl mx-auto space-y-6">
          {notice && (
            <div className="rounded-lg border border-amber-600/40 bg-amber-600/10 p-3 text-[13px] text-amber-800 dark:text-amber-400">
              <NoticeContent notice={notice} />
            </div>
          )}

          {/* Mode selector */}
          <div className="space-y-2">
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
            <p className="text-[12px] text-textColor/60">
              {mode === 'chat'
                ? t(
                    'chat_mode_description',
                    'Answer a few quick questions in conversation and iterate on ideas together.'
                  )
                : t(
                    'prompt_mode_description',
                    'Describe the design in one shot — no questions, straight to concepts.'
                  )}
            </p>
          </div>

          {/* Channels */}
          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <div>
                <h2 className="text-[14px] font-semibold text-textColor">
                  {t('channels_formats', 'Channels / formats')}
                </h2>
                <p className="text-[12px] text-textColor/60">
                  {t(
                    'select_output_formats_hint',
                    'Select the output formats you want designs for — pick one or more.'
                  )}
                </p>
              </div>
              {selectedChannels.length > 0 && (
                <span className="shrink-0 px-2 py-0.5 rounded-full bg-designerAccent/15 text-[11px] font-medium text-textColor tabular-nums">
                  {t('n_selected_count', '{{count}} selected', {
                    count: selectedChannels.length,
                  })}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {imagePresets.map((preset) => {
                const active = selectedChannels.includes(preset.id);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => toggleChannel(preset.id)}
                    aria-pressed={active}
                    className={`group relative flex items-center gap-2.5 p-3 rounded-xl border text-left transition-colors ${
                      active
                        ? 'border-designerAccent bg-designerAccent/10'
                        : 'border-studioBorder hover:border-designerAccent/60 hover:bg-boxHover'
                    }`}
                  >
                    {preset.provider && (
                      <PlatformIcon
                        identifier={preset.provider}
                        name={preset.name}
                        size={26}
                        className="shrink-0"
                      />
                    )}
                    <span className="min-w-0 flex flex-col">
                      <span className="text-[13px] font-medium text-textColor truncate">
                        {preset.name}
                      </span>
                      <span className="text-[11px] text-newTableText tabular-nums">
                        {preset.width} × {preset.height}
                      </span>
                    </span>
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 end-1.5 w-[16px] h-[16px] rounded-full bg-designerAccent flex items-center justify-center"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}

              {/* Not a size — a toggle for the custom-size panel below. It used to
                  be a `custom` preset that silently added a hardcoded 1080×1080. */}
              <button
                type="button"
                onClick={() => setShowCustomSizes((v) => !v)}
                aria-expanded={showCustomSizes}
                aria-controls="ai-designer-custom-sizes"
                className={`flex items-center gap-2.5 p-3 rounded-xl border border-dashed text-left transition-colors ${
                  showCustomSizes || customSizes.length > 0
                    ? 'border-designerAccent bg-designerAccent/10'
                    : 'border-studioBorder hover:border-designerAccent/60 hover:bg-boxHover'
                }`}
              >
                <span className="shrink-0 w-[26px] h-[26px] rounded-md border border-dashed border-newTableText flex items-center justify-center text-newTableText">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="text-[13px] font-medium text-textColor truncate">
                    {t('custom_sizes', 'Custom sizes')}
                  </span>
                  <span className="text-[11px] text-newTableText tabular-nums">
                    {customSizes.length > 0
                      ? t('n_added_count', '{{count}} added', { count: customSizes.length })
                      : t('set_your_own', 'Set your own')}
                  </span>
                </span>
              </button>
            </div>
          </section>

          {/* Custom sizes — revealed by the Custom sizes card in the grid above. */}
          {showCustomSizes && (
          <section id="ai-designer-custom-sizes" className="space-y-3 rounded-xl border border-studioBorder bg-newBgColorInner/40 p-4">
            <div>
              <h2 className="text-[14px] font-semibold text-textColor">
                {t('custom_sizes', 'Custom sizes')}
              </h2>
              <p className="text-[12px] text-newTableText">
                {t(
                  'custom_size_range_hint',
                  'Anything from 16 to 4096 pixels per side.'
                )}
              </p>
            </div>
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
                className="w-24 h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor text-center outline-hidden focus:border-designerAccent"
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
                className="w-24 h-[40px] rounded-lg border border-studioBorder bg-newBgColorInner px-3 text-[14px] text-textColor text-center outline-hidden focus:border-designerAccent"
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
          )}

          {/* Save path & brand */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-[6px]">
              <span className="text-[14px] text-textColor">
                {t('save_to_folder', 'Save to folder')}
              </span>
              <button
                type="button"
                onClick={openFolderPicker}
                className="h-[42px] flex items-center gap-[8px] rounded-[8px] border border-studioBorder bg-newBgColorInner px-[16px] text-[14px] text-textColor text-left hover:border-designerAccent/60 transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-newTableText" aria-hidden="true">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span className="truncate">
                  {saveFolderName || t('files_root', 'Files (root)')}
                </span>
              </button>
            </div>

            <div className="flex flex-col gap-[6px]">
              <label htmlFor="brandProfileId" className="text-[14px] text-textColor">
                {t('brand_profile', 'Brand profile')}
              </label>
              <select
                id="brandProfileId"
                value={brandProfileId}
                onChange={(e) => setBrandProfileId(e.target.value)}
                className="h-[42px] rounded-[8px] border border-studioBorder bg-newBgColorInner px-[16px] text-[14px] text-textColor outline-hidden focus:border-designerAccent"
              >
                <option value="">{t('none', 'None')}</option>
                {brands?.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-[6px]">
              <label htmlFor="aiDesignerStyleId" className="text-[14px] text-textColor">
                {t('style', 'Style')}
              </label>
              <select
                id="aiDesignerStyleId"
                value={styleId}
                onChange={(e) => setStyleId(e.target.value)}
                className="h-[42px] rounded-[8px] border border-studioBorder bg-newBgColorInner px-[16px] text-[14px] text-textColor outline-hidden focus:border-designerAccent"
              >
                <option value="">{t('let_ai_decide', 'Let AI decide')}</option>
                {STYLE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.title} — {preset.description}
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
            {/* Honest scope: references are interpreted into the brief (style,
                mood, subject) — the image generator cannot copy them. */}
            <p className="text-[12px] text-textColor/50">
              {t(
                'reference_images_guide_the_brief',
                'References guide the brief — style, mood and subject. The generated imagery is an interpretation, not a copy.'
              )}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                secondary
                onClick={referencePicker.open}
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
                      className="w-5 h-5 rounded-sm object-cover"
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
                className="w-full rounded-lg border border-studioBorder bg-newBgColorInner p-3 text-[14px] text-textColor outline-hidden focus:border-designerAccent resize-none"
              />
            </section>
          )}

          <div className="pt-2 space-y-2">
            <div className="flex items-center gap-2">
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
            {isConnected &&
              selectedChannels.length === 0 &&
              customSizes.length === 0 && (
                <p className="text-[12px] text-textColor/50">
                  {t(
                    'select_at_least_one_format_to_continue',
                    'Select at least one format to continue'
                  )}
                </p>
              )}
          </div>
        </div>
      </div>

      {referencePicker.element}
    </div>
  );
};
