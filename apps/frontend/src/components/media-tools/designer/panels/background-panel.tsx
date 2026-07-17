'use client';

import React, { FC, useCallback, useEffect, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import type { DesignerGradient } from '../designer.store';
import { ColorSwatch, Slider, SegmentedControl } from '../controls';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useBrandColors } from './use-brand-colors';
import { MediaSelectorModal } from '../../media-selector-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface BackgroundPanelProps {
  store: ReturnType<typeof import('../designer.store').createDesignerStore>;
  onClose?: () => void;
}

interface FileItem {
  id: string;
  path: string;
  name: string;
}

const colorPresets = [
  { label: 'White', labelKey: 'designer_color_white', color: '#ffffff' },
  { label: 'Black', labelKey: 'designer_color_black', color: '#000000' },
  { label: 'Blue', labelKey: 'blue', color: '#2B5CD3' },
  { label: 'Dark Blue', labelKey: 'designer_color_dark_blue', color: '#1e2a4a' },
  { label: 'Red', labelKey: 'designer_color_red', color: '#e53935' },
  { label: 'Green', labelKey: 'green', color: '#43a047' },
  { label: 'Purple', labelKey: 'purple', color: '#7b1fa2' },
  { label: 'Orange', labelKey: 'orange', color: '#fb8c00' },
  { label: 'Gray', labelKey: 'designer_color_gray', color: '#9e9e9e' },
  { label: 'Light Gray', labelKey: 'designer_color_light_gray', color: '#f5f5f5' },
];

type Mode = 'color' | 'gradient' | 'image';

export const BackgroundPanel: FC<BackgroundPanelProps> = ({ store }) => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const brandColors = useBrandColors();
  const brandEnforcement = store((s) => s.brandEnforcement);
  const [mode, setMode] = useState<Mode>('color');
  const currentBg = store(
    (s) =>
      (s.doc.outputs[s.currentOutput] as import('../designer.store').DesignerOutput)
        ?.background || '#ffffff'
  );

  // Gradient builder state.
  const [stop0, setStop0] = useState('#2B5CD3');
  const [stop1, setStop1] = useState('#1e2a4a');
  const [angle, setAngle] = useState(90);
  const [gradientType, setGradientType] = useState<'linear' | 'radial'>('linear');

  // Image-from-URL state.
  const [imageUrl, setImageUrl] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  const setColor = useCallback(
    (color: string) => {
      store.getState().setOutputBackground({ type: 'color', color });
    },
    [store]
  );

  const applyGradient = useCallback(() => {
    const gradient: DesignerGradient = {
      type: gradientType,
      angle,
      stops: [
        { offset: 0, color: stop0 },
        { offset: 1, color: stop1 },
      ],
    };
    store.getState().setOutputBackground({ type: 'gradient', gradient });
  }, [store, gradientType, angle, stop0, stop1]);

  const setImage = useCallback(
    (src: string, fileId?: string) => {
      if (!src) return;
      store.getState().setOutputBackground({ type: 'image', src, fileId });
    },
    [store]
  );

  const handleModalSelect = useCallback((item: {
    source: 'stock' | 'file';
    url: string;
    fileId?: string;
    width: number;
    height: number;
    type: 'image' | 'video' | 'audio';
  }) => {
    if (item.type !== 'image') return;
    setImage(item.url, item.fileId);
    setModalOpen(false);
  }, [setImage]);

  // CSS preview of the gradient.
  const gradientCss =
    gradientType === 'linear'
      ? `linear-gradient(${angle}deg, ${stop0}, ${stop1})`
      : `radial-gradient(circle, ${stop0}, ${stop1})`;

  const { data, error, isLoading, mutate } = useSWR(
    mode === 'image' ? `background-files-${user.orgId}-page-1` : null,
    async () => {
      const res = await fetch('/files?page=1&limit=20');
      if (!res.ok) throw new Error('Failed to load files');
      return res.json() as Promise<{ pages: number; results: FileItem[] }>;
    },
    { keepPreviousData: true }
  );

  // Surface the load failure from an effect, not inline in render.
  useEffect(() => {
    if (error && !data) toaster.show(t('designer_couldnt_load_files', "Couldn't load files"), 'warning');
  }, [error, data, toaster, t]);

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        value={mode}
        options={[
          { value: 'color', label: t('color', 'Color') },
          { value: 'gradient', label: t('designer_gradient', 'Gradient') },
          { value: 'image', label: t('provider_chip_image', 'Image') },
        ]}
        onChange={(v) => setMode(v as Mode)}
      />

      {mode === 'color' && (
        <>
          <div className="grid grid-cols-5 gap-2">
            {colorPresets.map((preset) => (
              <button
                key={preset.color}
                onClick={() => setColor(preset.color)}
                title={t(preset.labelKey, preset.label)}
                className={`w-full aspect-square rounded-lg border-2 transition-all ${
                  currentBg === preset.color
                    ? 'border-designerAccent ring-1 ring-designerAccent'
                    : 'border-studioBorder hover:border-designerAccent'
                }`}
              >
                <div
                  className="w-full h-full rounded-[5px]"
                  style={{ backgroundColor: preset.color }}
                />
              </button>
            ))}
          </div>

          <ColorSwatch
            label={t('custom_color', 'Custom color')}
            value={/^#[0-9a-fA-F]{6}$/.test(currentBg) ? currentBg : '#ffffff'}
            onChange={setColor}
            brandColors={brandColors}
            brandEnforcement={brandEnforcement}
          />
        </>
      )}

      {mode === 'gradient' && (
        <div className="flex flex-col gap-3">
          <div
            className="w-full h-16 rounded-lg border border-studioBorder"
            style={{ background: gradientCss }}
          />

          <SegmentedControl
            value={gradientType}
            options={[
              { value: 'linear', label: t('designer_linear', 'Linear') },
              { value: 'radial', label: t('designer_radial', 'Radial') },
            ]}
            onChange={(v) => setGradientType(v as 'linear' | 'radial')}
          />

          <div className="grid grid-cols-2 gap-3">
            <ColorSwatch label={t('designer_gradient_start', 'Start')} value={stop0} onChange={setStop0} brandColors={brandColors} brandEnforcement={brandEnforcement} />
            <ColorSwatch label={t('designer_gradient_end', 'End')} value={stop1} onChange={setStop1} brandColors={brandColors} brandEnforcement={brandEnforcement} />
          </div>

          {gradientType === 'linear' && (
            <Slider
              label={t('designer_label_angle', 'Angle')}
              min={0}
              max={360}
              suffix="°"
              value={angle}
              onChange={setAngle}
            />
          )}

          <button
            onClick={applyGradient}
            className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
          >
            {t('designer_apply_gradient', 'Apply gradient')}
          </button>
        </div>
      )}

      {mode === 'image' && (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder={t('designer_placeholder_image_url', 'Image URL…')}
              className="flex-1 h-[36px] px-3 rounded-lg bg-newBgColorInner border border-studioBorder text-[13px] outline-none focus:border-designerAccent text-textColor"
            />
            <button
              onClick={() => setImage(imageUrl.trim())}
              disabled={!imageUrl.trim()}
              className="px-[12px] h-[36px] rounded-lg bg-designerAccent text-white text-[13px] font-medium hover:bg-designerAccent/80 disabled:opacity-50 shrink-0"
            >
              {t('designer_use', 'Use')}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
          >
            {t('designer_choose_from_media_library', 'Choose from media library…')}
          </button>

          <MediaSelectorModal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            onSelect={handleModalSelect}
          />

          <div className="text-[11px] text-newTextColor/60">{t('designer_from_your_files', 'From your files')}</div>

          {isLoading && !data ? (
            <PanelSkeletonGrid count={4} />
          ) : error && !data ? (
            <PanelError
              message={t('designer_couldnt_load_files', "Couldn't load files")}
              onRetry={() => mutate()}
            />
          ) : !data?.results?.length ? (
            <div className="text-[12px] text-newTextColor/60 text-center py-4">
              {t('no_files_found', 'No files found')}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {data.results.map((file) => (
                <button
                  key={file.id}
                  onClick={() => setImage(file.path, file.id)}
                  className="group rounded-lg overflow-hidden border border-studioBorder bg-newBgColorInner hover:border-designerAccent transition-all"
                >
                  <div className="aspect-[4/3] relative overflow-hidden bg-studioBorder/10">
                    {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                    <img
                      src={file.path}
                      alt={file.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      loading="lazy"
                    />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
