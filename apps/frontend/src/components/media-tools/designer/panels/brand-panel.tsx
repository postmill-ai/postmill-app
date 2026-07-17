'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { PanelSkeletonGrid, PanelError } from './panel-states';
import { useCustomFonts, CustomFontEntry } from './use-brand-fonts';
import { getBrandViolations } from '../brand-compliance';
import { MediaSelectorModal } from '../../media-selector-modal';

interface BrandProfile {
  id: string;
  name: string;
  palette?: string[];
  fontFamilies?: string[];
  logoFileIds?: string[];
  introFileId?: string | null;
  outroFileId?: string | null;
  enforcement?: { enabled?: boolean };
  isDefault: boolean;
}

interface FileItem {
  id: string;
  path: string;
  name: string;
}

interface BrandPanelProps {
  store: any;
}

export const BrandPanel: FC<BrandPanelProps> = ({ store }) => {
  const t = useT();
  const fetch = useFetch();
  const user = useUser();
  const toaster = useToaster();
  const selectedIds = store((s: any) => s.selectedIds);
  const out = store((s: any) => s.doc.outputs[s.currentOutput]);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const { fonts: customFonts, mutate: mutateCustomFonts } = useCustomFonts();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: brands, mutate } = useSWR<BrandProfile[]>(
    `brands-list-${user.orgId}`,
    async () => {
      const res = await fetch('/brands');
      if (!res.ok) return [];
      return res.json();
    },
    { revalidateOnFocus: false, keepPreviousData: true }
  );

  const activeBrand = useMemo(
    () => brands?.find((b) => b.isDefault) || brands?.[0] || null,
    [brands]
  );

  const selectedElement = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return out?.children.find(
      (el: any) => el.id === selectedIds[0]
    );
  }, [selectedIds, out]);

  const palette: string[] = useMemo(
    () => (Array.isArray(activeBrand?.palette) ? activeBrand!.palette! : []),
    [activeBrand]
  );

  const fontFamilies: string[] = useMemo(
    () =>
      Array.isArray(activeBrand?.fontFamilies)
        ? activeBrand!.fontFamilies!
        : [],
    [activeBrand]
  );

  const logoFileIds: string[] = useMemo(
    () =>
      Array.isArray(activeBrand?.logoFileIds) ? activeBrand!.logoFileIds! : [],
    [activeBrand]
  );

  const brandEnforcement = store((s: any) => s.brandEnforcement);
  const brandAdminOverride = store((s: any) => s.brandAdminOverride);
  const doc = store((s: any) => s.doc);

  useEffect(() => {
    const enabled = !!activeBrand?.enforcement?.enabled;
    store.getState().setBrandEnforcement(enabled);
  }, [activeBrand, store]);

  const enforcementEnabled = activeBrand?.enforcement?.enabled ?? false;

  const brandFontList = useMemo(
    () => [...fontFamilies, ...customFonts.map((f) => f.family)],
    [fontFamilies, customFonts]
  );

  const violations = useMemo(
    () =>
      getBrandViolations(doc, {
        enforcement: brandEnforcement,
        adminOverride: brandAdminOverride,
        brandColors: palette,
        brandFonts: brandFontList,
      }),
    [doc, brandEnforcement, brandAdminOverride, palette, brandFontList]
  );

  const canAdminOverride = user?.role === 'owner' || user?.role === 'admin';

  // Org files for the logo picker.
  const {
    data: files,
    error: filesError,
    isLoading: filesLoading,
    mutate: mutateFiles,
  } = useSWR(
    `brand-logo-files-${user.orgId}`,
    async () => {
      const res = await fetch('/files?page=1&limit=20');
      if (!res.ok) throw new Error('Failed to load files');
      return res.json() as Promise<{ pages: number; results: FileItem[] }>;
    },
    { keepPreviousData: true }
  );

  const fileById = useMemo(() => {
    const map = new Map<string, FileItem>();
    (files?.results || []).forEach((f) => map.set(f.id, f));
    return map;
  }, [files]);

  // Surface the files-load failure from an effect, not inline in render (a
  // render-time toaster.show fires on every render and warns about setState in
  // render).
  useEffect(() => {
    if (filesError && !files) toaster.show(t('designer_couldnt_load_files', "Couldn't load files"), 'warning');
  }, [filesError, files, toaster, t]);

  const handleColorClick = useCallback(
    (color: string) => {
      if (!selectedElement) return;
      store.getState().updateElement(selectedElement.id, { fill: color });
    },
    [store, selectedElement]
  );

  const handleFontClick = useCallback(
    (font: string) => {
      if (!selectedElement || selectedElement.type !== 'text') return;
      store.getState().updateElement(selectedElement.id, { fontFamily: font });
    },
    [store, selectedElement]
  );

  const persist = useCallback(
    async (patch: Partial<BrandProfile>) => {
      if (!activeBrand) return;
      setSaving(true);
      try {
        const res = await fetch(`/brands/${activeBrand.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            logoFileIds: activeBrand.logoFileIds || [],
            palette: activeBrand.palette || [],
            fontFamilies: activeBrand.fontFamilies || [],
            enforcement: activeBrand.enforcement || {},
            ...patch,
          }),
        });
        if (!res.ok) {
          toaster.show(t('designer_failed_save_brand_kit', 'Failed to save brand kit'), 'warning');
          return;
        }
        toaster.show(t('designer_brand_kit_saved', 'Brand kit saved'), 'success');
        mutate();
      } finally {
        setSaving(false);
      }
    },
    [activeBrand, fetch, toaster, mutate]
  );

  const toggleLogo = useCallback(
    (fileId: string) => {
      const next = logoFileIds.includes(fileId)
        ? logoFileIds.filter((id) => id !== fileId)
        : [...logoFileIds, fileId];
      persist({ logoFileIds: next });
    },
    [logoFileIds, persist]
  );

  const addLogoToCanvas = useCallback(
    (file: FileItem) => {
      const state = store.getState();
      const out = state.doc.outputs[state.currentOutput];
      const w = Math.min(300, out.width * 0.5);
      state.addElement({
        id: '',
        type: 'image',
        x: (out.width - w) / 2,
        y: (out.height - w) / 2,
        width: w,
        height: w,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        src: file.path,
        fileId: file.id,
      });
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
    addLogoToCanvas({ id: item.fileId || '', path: item.url, name: 'Logo' });
    setModalOpen(false);
  }, [addLogoToCanvas]);

  const handleFontUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['ttf', 'otf', 'woff2'].includes(ext)) {
        toaster.show(t('designer_invalid_font_file_type', 'Invalid file type. Accepted: .ttf, .otf, .woff2'), 'warning');
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        toaster.show(t('designer_font_file_too_large', 'Font file must be under 5MB'), 'warning');
        return;
      }
      setUploading(true);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/media/fonts/upload', {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          toaster.show(err.message || t('designer_upload_failed', 'Upload failed'), 'warning');
          return;
        }
        toaster.show(t('designer_font_uploaded', 'Font uploaded'), 'success');
        mutateCustomFonts();
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [fetch, toaster, mutateCustomFonts]
  );

  const handleFontDelete = useCallback(
    async (font: CustomFontEntry) => {
      try {
        const res = await fetch(`/media/fonts/${font.fileId}`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          toaster.show(t('designer_failed_remove_font', 'Failed to remove font'), 'warning');
          return;
        }
        toaster.show(t('designer_font_removed', 'Font removed'), 'success');
        mutateCustomFonts();
      } catch {
        toaster.show(t('designer_failed_remove_font', 'Failed to remove font'), 'warning');
      }
    },
    [fetch, toaster, mutateCustomFonts]
  );

  // Distinguish loading (brands === undefined) from empty (no profiles). The
  // early return must sit AFTER every hook — `doc.mode` is read below via the
  // already-hoisted `doc` selector, never a fresh conditional `store(...)` hook,
  // which previously crashed the panel with a hook-count mismatch once brands
  // loaded.
  if (brands === undefined) {
    return (
      <div className="text-newTextColor/60 text-[12px] text-center py-8">
        {t('designer_loading_brand_profiles', 'Loading brand profiles…')}
      </div>
    );
  }
  if (brands.length === 0) {
    return (
      <div className="text-newTextColor/60 text-[12px] text-center py-8">
        {t('designer_no_brand_profiles', 'No brand profiles found. Create one in Settings → Brands.')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_brand_profile', 'Brand Profile')}
          </div>
          {saving && (
            <span className="text-[11px] text-newTextColor/60">{t('designer_saving_ellipsis', 'Saving…')}</span>
          )}
        </div>
        <select
          value={activeBrand?.id || ''}
          onChange={() => {
            // Brand selection is informational; palette/fonts are reactive.
          }}
          className="w-full h-[34px] px-[8px] rounded-[6px] bg-newBgColor border border-studioBorder text-[13px] text-textColor outline-none focus:border-designerAccent"
        >
          {brands.map((brand) => (
            <option key={brand.id} value={brand.id}>
              {brand.name}
            </option>
          ))}
        </select>
      </div>

      {/* Brand enforcement (T-38) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_brand_enforcement', 'Brand Enforcement')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={enforcementEnabled}
            onClick={() =>
              persist({
                enforcement: { enabled: !enforcementEnabled },
              })
            }
            className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
              enforcementEnabled ? 'bg-purple-500' : 'bg-studioBorder'
            }`}
          >
            <span
              className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                enforcementEnabled ? 'translate-x-[18px]' : ''
              }`}
            />
          </button>
        </div>
        <div className="text-[11px] text-newTextColor/65">
          {t('designer_brand_enforcement_desc', 'When on, only brand colors and fonts can be used.')}
        </div>

        {brandEnforcement && violations.length > 0 && (
          <div className="rounded-[6px] border border-red-400/30 bg-red-400/10 p-2">
            <div className="text-[11px] text-dangerText font-medium mb-1">
              {t('designer_off_brand_detected', 'Off-brand elements detected')}
            </div>
            <ul className="text-[10px] text-newTextColor/60 list-disc pl-4 space-y-0.5 max-h-[120px] overflow-y-auto">
              {violations.slice(0, 5).map((v, i) => (
                <li key={i}>{t(v.key, v.text, v.vars)}</li>
              ))}
              {violations.length > 5 && (
                <li>{t('designer_and_more_count', '…and {{count}} more', { count: violations.length - 5 })}</li>
              )}
            </ul>
          </div>
        )}

        {brandEnforcement && canAdminOverride && (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={brandAdminOverride}
              onChange={(e) =>
                store.getState().setBrandAdminOverride(e.target.checked)
              }
              className="accent-purple-500 w-[14px] h-[14px]"
            />
            <span className="text-[11px] text-newTextColor/70">
              {t('designer_admin_override_desc', 'Admin override — allow save/export')}
            </span>
          </label>
        )}
      </div>

      {/* Logos (E5) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ProviderIcon identifier="LOCAL" name="Storage" size={16} />
          <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_logos', 'Logos')}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="w-full px-3 py-2 rounded-lg text-[12px] font-medium bg-designerAccent text-white hover:bg-designerAccent/80"
        >
          {t('designer_add_logo_from_media', 'Add logo from media…')}
        </button>

        <MediaSelectorModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          onSelect={handleModalSelect}
        />

        {logoFileIds.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {logoFileIds.map((id) => {
              const file = fileById.get(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => file && addLogoToCanvas(file)}
                  title={file ? t('designer_add_file_to_canvas', 'Add {{name}} to canvas', { name: file.name }) : id}
                  className="group relative aspect-square rounded-lg overflow-hidden border border-designerAccent bg-newBgColorInner"
                >
                  {file ? (
                    // eslint-disable-next-line @next/next/no-img-element -- external media file
                    <img
                      src={file.path}
                      alt={file.name}
                      className="w-full h-full object-contain p-1"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-[10px] text-newTextColor/60">
                      ?
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="text-[11px] text-newTextColor/60">{t('designer_pick_from_files', 'Pick from files')}</div>
        {filesLoading && !files ? (
          <PanelSkeletonGrid count={3} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />
        ) : filesError && !files ? (
          <PanelError message={t('designer_couldnt_load_files', "Couldn't load files")} onRetry={() => mutateFiles()} />
        ) : !files?.results?.length ? (
          <div className="text-[12px] text-newTextColor/60 text-center py-2">
            {t('no_files_found', 'No files found')}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {files.results.map((file) => {
              const picked = logoFileIds.includes(file.id);
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => toggleLogo(file.id)}
                  aria-pressed={picked}
                  title={file.name}
                  className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all ${
                    picked
                      ? 'border-designerAccent ring-1 ring-designerAccent'
                      : 'border-studioBorder hover:border-designerAccent'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- external media file */}
                  <img
                    src={file.path}
                    alt={file.name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  {picked && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-designerAccent text-white text-[10px] flex items-center justify-center">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Intro / Outro */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <ProviderIcon identifier="LOCAL" name="Storage" size={16} />
          <span className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_intro_outro', 'Intro / Outro')}
          </span>
        </div>

        <div className="text-[11px] text-newTextColor/60">{t('designer_pick_from_video_files', 'Pick from video files')}</div>
        {filesLoading && !files ? (
          <PanelSkeletonGrid count={3} columnsClassName="grid-cols-3" aspectClassName="aspect-square" />
        ) : filesError && !files ? (
          <PanelError message={t('designer_couldnt_load_files', "Couldn't load files")} onRetry={() => mutateFiles()} />
        ) : !files?.results?.length ? (
          <div className="text-[12px] text-newTextColor/60 text-center py-2">
            {t('no_files_found', 'No files found')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {files.results
              .filter((f) => /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(f.path))
              .map((file) => {
                const isIntro = activeBrand?.introFileId === file.id;
                const isOutro = activeBrand?.outroFileId === file.id;
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() => {
                      if (isIntro) persist({ introFileId: null });
                      else if (isOutro) persist({ outroFileId: null });
                      else persist({ introFileId: file.id });
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      if (isOutro) persist({ outroFileId: null });
                      else persist({ outroFileId: file.id });
                    }}
                    title={t('designer_intro_outro_hint', '{{name}} — click=intro, right-click=outro', { name: file.name })}
                    className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all ${
                      isIntro || isOutro
                        ? 'border-designerAccent ring-1 ring-designerAccent'
                        : 'border-studioBorder hover:border-designerAccent'
                    }`}
                  >
                    <video
                      src={file.path}
                      className="w-full h-full object-cover"
                      muted
                      preload="metadata"
                    />
                    {(isIntro || isOutro) && (
                      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] bg-designerAccent text-white">
                        {isIntro ? t('designer_intro_badge', 'INTRO') : t('designer_outro_badge', 'OUTRO')}
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        )}

        {doc.mode === 'video' && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!activeBrand?.introFileId}
              onClick={() => {
                const state = store.getState();
                const file = fileById.get(activeBrand?.introFileId || '');
                if (!file || state.doc.mode !== 'video') return;
                const vo = state.doc.outputs[state.currentOutput] as any;
                let track = vo.tracks?.find((t: any) => t.type === 'video');
                if (!track) {
                  state.addTrack(state.currentOutput, 'video');
                  track = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'video');
                }
                if (!track) return;
                const maxIntroMs = Math.min(5000, vo.durationMs / 4);
                state.addClip(state.currentOutput, track.id, {
                  id: '',
                  startMs: 0,
                  endMs: maxIntroMs,
                  src: file.path,
                  fileId: file.id,
                  width: vo.width,
                  height: vo.height,
                });
                state.pushHistory();
                toaster.show(t('designer_intro_added_to_timeline', 'Intro added to timeline'), 'success');
              }}
              className="flex-1 px-2 py-1.5 rounded text-[11px] border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-40"
            >
              {t('designer_apply_intro', 'Apply intro')}
            </button>
            <button
              type="button"
              disabled={!activeBrand?.outroFileId}
              onClick={() => {
                const state = store.getState();
                const file = fileById.get(activeBrand?.outroFileId || '');
                if (!file || state.doc.mode !== 'video') return;
                const vo = state.doc.outputs[state.currentOutput] as any;
                let track = vo.tracks?.find((t: any) => t.type === 'video');
                if (!track) {
                  state.addTrack(state.currentOutput, 'video');
                  track = (store.getState().doc.outputs[state.currentOutput] as any).tracks.find((t: any) => t.type === 'video');
                }
                if (!track) return;
                const maxOutroMs = Math.min(5000, vo.durationMs / 4);
                state.addClip(state.currentOutput, track.id, {
                  id: '',
                  startMs: vo.durationMs - maxOutroMs,
                  endMs: vo.durationMs,
                  src: file.path,
                  fileId: file.id,
                  width: vo.width,
                  height: vo.height,
                });
                state.pushHistory();
                toaster.show(t('designer_outro_added_to_timeline', 'Outro added to timeline'), 'success');
              }}
              className="flex-1 px-2 py-1.5 rounded text-[11px] border border-designerAccent/30 text-btnPrimaryAccent hover:bg-designerAccent/10 disabled:opacity-40"
            >
              {t('designer_apply_outro', 'Apply outro')}
            </button>
          </div>
        )}
      </div>

      {/* Palette (E5) */}
      {palette.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_palette', 'Palette')}
          </div>
          <div className="flex flex-wrap gap-2">
            {palette.map((color, i) => (
              <button
                key={i}
                onClick={() => handleColorClick(color)}
                disabled={!selectedElement}
                className={`w-8 h-8 rounded-[6px] border-2 border-studioBorder hover:scale-110 transition-all ${
                  !selectedElement ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                }`}
                style={{ backgroundColor: color }}
                title={color}
              />
            ))}
          </div>
          {!selectedElement && (
            <div className="text-[11px] text-newTextColor/60">
              {t('designer_select_element_apply_color', 'Select an element to apply color')}
            </div>
          )}
        </div>
      )}

      {/* Fonts (E5) */}
      {fontFamilies.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
            {t('designer_fonts', 'Fonts')}
          </div>
          <div className="flex flex-col gap-1">
            {fontFamilies.map((font, i) => (
              <button
                key={i}
                onClick={() => handleFontClick(font)}
                disabled={!selectedElement || selectedElement.type !== 'text'}
                className={`text-left px-3 py-2 rounded-[6px] border border-studioBorder text-[13px] transition-all ${
                  !selectedElement || selectedElement.type !== 'text'
                    ? 'opacity-40 cursor-not-allowed text-textColor/60'
                    : 'text-textColor hover:border-designerAccent hover:bg-boxHover cursor-pointer'
                }`}
                style={{ fontFamily: font }}
              >
                {font}
              </button>
            ))}
          </div>
          {(!selectedElement || selectedElement.type !== 'text') && (
            <div className="text-[11px] text-newTextColor/60">
              {t('designer_select_text_apply_font', 'Select a text element to apply font')}
            </div>
          )}
        </div>
      )}

      {/* Custom Fonts (T-32) */}
      <div className="flex flex-col gap-2">
        <div className="text-[12px] font-medium text-textColor/60 uppercase tracking-wider">
          {t('designer_brand_fonts', 'Brand Fonts')}
        </div>

        {customFonts.length > 0 && (
          <div className="flex flex-col gap-1">
            {customFonts.map((f) => (
              <div
                key={f.fileId}
                className="flex items-center justify-between px-3 py-2 rounded-[6px] border border-studioBorder bg-newBgColorInner"
              >
                <button
                  type="button"
                  onClick={() => handleFontClick(f.family)}
                  disabled={!selectedElement || selectedElement.type !== 'text'}
                  className={`text-left flex-1 text-[13px] truncate ${
                    !selectedElement || selectedElement.type !== 'text'
                      ? 'text-textColor/60'
                      : 'text-textColor hover:text-btnPrimaryAccent cursor-pointer'
                  }`}
                  style={{ fontFamily: `"${f.family}"` }}
                >
                  {f.family}
                </button>
                <button
                  type="button"
                  onClick={() => handleFontDelete(f)}
                  className="ml-2 w-5 h-5 rounded-full border border-studioBorder text-[11px] text-textColor/60 hover:text-dangerText hover:border-red-400 flex items-center justify-center shrink-0 transition-colors"
                  title={t('designer_remove_font', 'Remove {{name}}', { name: f.family })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept=".ttf,.otf,.woff2"
          onChange={handleFontUpload}
          className="hidden"
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="w-full py-2 rounded-[6px] border border-dashed border-studioBorder text-[12px] text-textColor/60 hover:text-textColor hover:border-designerAccent bg-newBgColorInner transition-colors"
        >
          {uploading ? t('designer_uploading_ellipsis', 'Uploading...') : t('designer_upload_font_cta', '+ Upload font (.ttf, .otf, .woff2)')}
        </button>
      </div>

      {palette.length === 0 &&
        fontFamilies.length === 0 &&
        logoFileIds.length === 0 &&
        customFonts.length === 0 && (
          <div className="text-newTextColor/60 text-[12px]">
            {t('designer_brand_empty_state', 'This brand has no palette, fonts, or logos configured yet.')}
          </div>
        )}
    </div>
  );
};
