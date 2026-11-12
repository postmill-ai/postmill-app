'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Slider } from '@postmill-ai/react/form/slider';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import {
  fontServerRenderable,
  useCustomFonts,
  useUploadCustomFont,
} from '@postmill-ai/frontend/components/media-tools/designer/panels/use-brand-fonts';
import type { Brand, BrandAsset } from './use-brands';

interface FileItem {
  id: string;
  path: string;
  name: string;
}

interface BrandTemplate {
  id: string;
  name: string;
  category?: string | null;
  isSystem: boolean;
  brandProfileId?: string | null;
  thumbnail?: string | null;
}

export const BrandAssets = ({
  brandId,
  initial,
  onSaved,
}: {
  brandId: string;
  initial?: Brand;
  onSaved?: () => void;
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const permissions = usePermissions();
  const canEdit = !permissions.isResolved || permissions.hasPermission('brands', 'update');
  const [palette, setPalette] = useState<string[]>(initial?.palette || []);
  const [assets, setAssets] = useState<BrandAsset[]>(initial?.assets || []);
  const [logoFileIds, setLogoFileIds] = useState<string[]>(initial?.logoFileIds || []);
  const [fontFamilies, setFontFamilies] = useState<string[]>(initial?.fontFamilies || []);
  const [preferredFormats, setPreferredFormats] = useState<string[]>(initial?.preferredFormats || []);
  const [introFileId, setIntroFileId] = useState<string | null>(initial?.introFileId || null);
  const [outroFileId, setOutroFileId] = useState<string | null>(initial?.outroFileId || null);
  const [enforcementEnabled, setEnforcementEnabled] = useState(!!initial?.enforcement?.enabled);
  const [newColor, setNewColor] = useState('#2B5CD3');
  const [newFontFamily, setNewFontFamily] = useState('');
  const [saving, setSaving] = useState(false);
  const fontInputRef = useRef<HTMLInputElement>(null);
  const { fonts: customFonts, mutate: mutateCustomFonts } = useCustomFonts(brandId);
  const { uploadMany: uploadCustomFonts, uploading } = useUploadCustomFont(brandId);

  const referencedFileIds = useMemo(() => [...new Set([
    ...logoFileIds,
    ...assets.map((asset) => asset.fileId).filter((id): id is string => !!id),
    introFileId,
    outroFileId,
  ].filter((id): id is string => !!id))].sort(), [logoFileIds, assets, introFileId, outroFileId]);
  const { data: files } = useSWR(
    `brand-studio-files-${brandId}-${referencedFileIds.join(',')}`,
    async () => {
      if (!referencedFileIds.length) return { results: [] };
      const res = await fetch(`/files/by-ids?ids=${encodeURIComponent(referencedFileIds.join(','))}`);
      if (!res.ok) throw new Error('Failed to load brand files');
      return res.json() as Promise<{ results: FileItem[] }>;
    },
    { revalidateOnFocus: false },
  );
  const fileById = useMemo(
    () => new Map((files?.results || []).map((file) => [file.id, file])),
    [files],
  );
  const { data: templateData, mutate: mutateTemplates } = useSWR(
    `brand-studio-templates-${brandId}`,
    async () => {
      const res = await fetch(`/media/design-templates?page=1&limit=24&scope=org&brandId=${encodeURIComponent(brandId)}`);
      if (!res.ok) throw new Error('Failed to load brand templates');
      return res.json() as Promise<{ templates: BrandTemplate[]; total: number }>;
    },
    { revalidateOnFocus: false },
  );
  const [extraTemplates, setExtraTemplates] = useState<BrandTemplate[]>([]);
  const [templatePage, setTemplatePage] = useState(1);
  const [loadingMoreTemplates, setLoadingMoreTemplates] = useState(false);
  useEffect(() => {
    setExtraTemplates([]);
    setTemplatePage(1);
  }, [brandId]);
  const orgTemplates = useMemo(
    () => [...(templateData?.templates || []), ...extraTemplates].filter((template) => !template.isSystem),
    [templateData, extraTemplates],
  );
  const hasMoreTemplates = orgTemplates.length < (templateData?.total || 0);
  const loadMoreTemplates = useCallback(async () => {
    setLoadingMoreTemplates(true);
    try {
      const next = templatePage + 1;
      const res = await fetch(`/media/design-templates?page=${next}&limit=24&scope=org&brandId=${encodeURIComponent(brandId)}`);
      if (!res.ok) return;
      const body = await res.json() as { templates: BrandTemplate[] };
      setExtraTemplates((current) => [...current, ...(body.templates || [])]);
      setTemplatePage(next);
    } finally {
      setLoadingMoreTemplates(false);
    }
  }, [brandId, fetch, templatePage]);
  const assignTemplate = useCallback(async (template: BrandTemplate, assign: boolean) => {
    if (!canEdit) return;
    const res = await fetch(`/media/design-templates/${template.id}`, {
      method: 'PUT',
      body: JSON.stringify({ brandProfileId: assign ? brandId : null }),
    });
    if (!res.ok) {
      toaster.show(t('brand_template_assignment_failed', 'Failed to update brand template'), 'warning');
      return;
    }
    setExtraTemplates([]);
    setTemplatePage(1);
    await mutateTemplates();
    toaster.show(t('brand_template_updated', 'Brand template updated'), 'success');
  }, [brandId, canEdit, fetch, mutateTemplates, toaster, t]);

  const addColor = useCallback(() => {
    const color = newColor.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(color) && !palette.includes(color)) {
      setPalette((current) => [...current, color]);
    }
  }, [newColor, palette]);

  const logoPicker = useMediaPicker({
    title: t('brand_logo', 'Brand logo'),
    kinds: ['image'],
    requireFile: true,
    importName: 'brand-logo',
    onSelect: (item) => {
      if (item.fileId) {
        setLogoFileIds((current) => current.includes(item.fileId!) ? current : [...current, item.fileId!]);
      }
    },
  });
  const assetPicker = useMediaPicker({
    title: t('brand_asset', 'Brand asset'),
    kinds: ['image'],
    requireFile: true,
    importName: 'brand-asset',
    onSelect: (item) =>
      setAssets((current) => [...current, { fileId: item.fileId, url: item.url, caption: '' }]),
  });
  const introPicker = useMediaPicker({
    title: t('designer_brand_intro', 'Intro video'),
    kinds: ['video'],
    requireFile: true,
    onSelect: (item) => setIntroFileId(item.fileId || null),
  });
  const outroPicker = useMediaPicker({
    title: t('designer_brand_outro', 'Outro video'),
    kinds: ['video'],
    requireFile: true,
    onSelect: (item) => setOutroFileId(item.fileId || null),
  });

  const save = useCallback(async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await fetch(`/brands/${brandId}`, {
        method: 'PUT',
        body: JSON.stringify({
          palette,
          assets,
          logoFileIds,
          fontFamilies,
          preferredFormats,
          introFileId,
          outroFileId,
          enforcement: { ...(initial?.enforcement || {}), enabled: enforcementEnabled },
        }),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        toaster.show(error.message || t('brand_assets_save_failed', 'Failed to save brand assets'), 'warning');
        return;
      }
      toaster.show(t('brand_assets_saved', 'Brand assets saved'), 'success');
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [brandId, canEdit, palette, assets, logoFileIds, fontFamilies, preferredFormats, introFileId, outroFileId, enforcementEnabled, initial?.enforcement, fetch, toaster, t, onSaved]);

  const addFontFamily = useCallback(() => {
    const family = newFontFamily.trim();
    if (family && !fontFamilies.includes(family)) {
      setFontFamilies((current) => [...current, family]);
    }
    setNewFontFamily('');
  }, [fontFamilies, newFontFamily]);

  const deleteFont = useCallback(async (fileId: string) => {
    if (!canEdit) return;
    const res = await fetch(`/media/fonts/${encodeURIComponent(fileId)}?brandId=${encodeURIComponent(brandId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toaster.show(t('designer_failed_remove_font', 'Failed to remove font'), 'warning');
      return;
    }
    await mutateCustomFonts();
    onSaved?.();
    toaster.show(t('designer_font_removed', 'Font removed'), 'success');
  }, [brandId, canEdit, fetch, mutateCustomFonts, onSaved, toaster, t]);

  const toggleFormat = (formatId: string) => {
    setPreferredFormats((current) => current.includes(formatId)
      ? current.filter((id) => id !== formatId)
      : [...current, formatId]);
  };

  return (
    <div className="my-[16px] flex flex-col gap-[16px]">
      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div>
          <div className="text-[14px]">{t('brand_assets', 'Brand Kit')}</div>
          <div className="text-[12px] text-newTableText">
            {t('brand_assets_description_v3', 'The visual source of truth for this brand. Designer and AI Designer use these colors, fonts, logos, images, formats, and templates.')}
          </div>
        </div>
        <div className="flex flex-col gap-[10px]">
          <div className="text-[13px]">{t('color_palette', 'Your brand colours')}</div>
          <div className="flex flex-wrap items-center gap-[8px]">
            {palette.map((color) => (
              <div key={color} className="group/sw relative w-[36px] h-[36px] rounded-[8px] border border-newTableBorder" style={{ backgroundColor: color }} title={color}>
                {canEdit && (
                  <button
                    onClick={() => setPalette((current) => current.filter((entry) => entry !== color))}
                    aria-label={`Remove ${color}`}
                    className="absolute top-[-6px] end-[-6px] w-[16px] h-[16px] rounded-full bg-newBgColorInner border border-newTableBorder text-[10px] text-dangerText opacity-0 group-hover/sw:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {palette.length === 0 && <span className="text-[12px] text-newTableText">{t('no_colors_yet', 'No colours yet')}</span>}
          </div>
          {canEdit && (
            <div className="flex items-center gap-[8px]">
              <input type="color" value={newColor} onChange={(event) => setNewColor(event.target.value)} aria-label="Brand color" className="w-[36px] h-[32px] rounded-[6px] border border-newTableBorder bg-transparent cursor-pointer p-0" />
              <input type="text" value={newColor} onChange={(event) => setNewColor(event.target.value)} aria-label="Hex color value" className="w-[110px] bg-newBgColor border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-[13px] text-textColor outline-hidden" />
              <button onClick={addColor} className="text-[12px] text-btnPrimaryAccent hover:underline">{t('add_color', 'Add colour')}</button>
            </div>
          )}
        </div>
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[13px]">{t('brand_logos', 'Logos')}</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
          {logoFileIds.map((fileId) => {
            const file = fileById.get(fileId);
            return (
              <div key={fileId} className="group/logo relative border border-newTableBorder rounded-[10px] bg-newBgColor aspect-square flex items-center justify-center overflow-hidden">
                {file ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={file.path} alt={file.name} className="w-full h-full object-contain p-[8px]" />
                ) : <span className="text-[11px] text-newTableText">{fileId}</span>}
                {canEdit && (
                  <button
                    onClick={() => setLogoFileIds((current) => current.filter((id) => id !== fileId))}
                    aria-label={t('remove_logo', 'Remove logo')}
                    className="absolute top-[6px] end-[6px] w-[22px] h-[22px] rounded-full bg-newBgColorInner border border-newTableBorder text-dangerText opacity-0 group-hover/logo:opacity-100 focus:opacity-100"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
          {canEdit && (
            <button onClick={logoPicker.open} className="border border-dashed border-newTableBorder rounded-[10px] aspect-square flex items-center justify-center text-[12px] text-newTableText hover:bg-boxHover">
              {t('add_logo', 'Add logo')}
            </button>
          )}
        </div>
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div>
          <div className="text-[13px]">{t('attached_assets', 'Reference images')}</div>
          <div className="text-[12px] text-newTableText">{t('reference_images_hint', 'Product photos, mascots, screenshots, and other imagery the Designer and AI Designer can use as references.')}</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px]">
          {assets.map((asset, index) => (
            <div key={asset.fileId || asset.url || index} className="border border-newTableBorder rounded-[10px] overflow-hidden bg-newBgColor flex flex-col">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.caption || ''} className="w-full h-[100px] object-cover" />
              <div className="p-[8px] flex flex-col gap-[6px]">
                <input
                  type="text"
                  value={asset.caption || ''}
                  disabled={!canEdit}
                  onChange={(event) => setAssets((current) => current.map((entry, entryIndex) => entryIndex === index ? { ...entry, caption: event.target.value } : entry))}
                  placeholder={t('caption_optional', 'Caption (optional)')}
                  className="w-full bg-newBgColorInner border border-newTableBorder rounded-[6px] px-[8px] py-[5px] text-[12px] text-textColor outline-hidden"
                />
                {canEdit && (
                  <button onClick={() => setAssets((current) => current.filter((_, entryIndex) => entryIndex !== index))} className="text-[11px] text-dangerText hover:underline self-start">
                    {t('remove', 'Remove')}
                  </button>
                )}
              </div>
            </div>
          ))}
          {canEdit && (
            <button onClick={assetPicker.open} className="border border-dashed border-newTableBorder rounded-[10px] min-h-[100px] flex items-center justify-center text-[12px] text-newTableText hover:bg-boxHover">
              {t('add_asset', 'Add asset')}
            </button>
          )}
        </div>
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div>
          <div className="text-[13px]">{t('preferred_formats', 'Preferred formats')}</div>
          <div className="text-[12px] text-newTableText">{t('preferred_formats_hint', 'These formats appear first for this brand. They are defaults, not restrictions.')}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[8px]">
          {CHANNEL_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => (
            <label key={preset.id} className="flex items-center gap-[8px] text-[12px] text-textColor">
              <input type="checkbox" checked={preferredFormats.includes(preset.id)} disabled={!canEdit} onChange={() => toggleFormat(preset.id)} />
              <span>{preset.name}</span>
              <span className="text-newTableText">{preset.width}×{preset.height}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div>
          <div className="text-[13px]">{t('brand_templates', 'Brand templates')}</div>
          <div className="text-[12px] text-newTableText">{t('brand_templates_hint', 'Templates assigned to this brand appear first in Brand Mode. Shared templates stay available in General Mode.')}</div>
        </div>
        <div className="flex flex-col gap-[8px]">
          {orgTemplates.filter((template) => template.brandProfileId === brandId).map((template) => (
            <div key={template.id} className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px]">
              <div>
                <div className="text-[13px]">{template.name}</div>
                <div className="text-[11px] text-newTableText">{template.category}</div>
              </div>
              {canEdit && <button onClick={() => assignTemplate(template, false)} className="text-[12px] text-dangerText">{t('unassign', 'Unassign')}</button>}
            </div>
          ))}
          {!orgTemplates.some((template) => template.brandProfileId === brandId) && (
            <div className="text-[12px] text-newTableText">{t('no_brand_templates', 'No templates assigned to this brand yet.')}</div>
          )}
        </div>
        {canEdit && orgTemplates.some((template) => template.brandProfileId !== brandId) && (
          <div className="flex flex-wrap gap-[8px]">
            {orgTemplates.filter((template) => template.brandProfileId !== brandId).map((template) => (
              <button key={template.id} onClick={() => assignTemplate(template, true)} className="border border-newTableBorder rounded-[6px] px-[8px] py-[5px] text-[12px] hover:bg-boxHover">
                {t('assign_template', 'Assign {{name}}', { name: template.name })}
              </button>
            ))}
          </div>
        )}
        {hasMoreTemplates && (
          <button
            type="button"
            onClick={loadMoreTemplates}
            disabled={loadingMoreTemplates}
            className="self-start border border-newTableBorder rounded-[6px] px-[10px] py-[6px] text-[12px] hover:bg-boxHover disabled:opacity-60"
          >
            {loadingMoreTemplates ? t('loading', 'Loading...') : t('templates_panel_load_more', 'Load more')}
          </button>
        )}
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[13px]">{t('brand_fonts', 'Brand fonts')}</div>
        <div className="flex flex-wrap gap-[8px]">
          {fontFamilies.map((family) => (
            <span key={family} className="inline-flex items-center gap-[6px] border border-newTableBorder rounded-[6px] px-[8px] py-[5px] text-[12px]">
              {family}
              {canEdit && <button onClick={() => setFontFamilies((current) => current.filter((entry) => entry !== family))} aria-label={t('remove_font_family', 'Remove {{family}}', { family })}>×</button>}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className="flex gap-[8px]">
            <input type="text" value={newFontFamily} onChange={(event) => setNewFontFamily(event.target.value)} placeholder={t('font_family_placeholder', 'Font family name')} className="bg-newBgColor border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-[13px] text-textColor outline-hidden" />
            <button onClick={addFontFamily} className="text-[12px] text-btnPrimaryAccent hover:underline">{t('add_font_family', 'Add font family')}</button>
          </div>
        )}
        <div className="flex flex-col gap-[8px]">
          {customFonts.map((font) => (
            <div key={font.fileId} className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px]">
              <div>
                <div className="text-[13px]">{font.family}</div>
                <div className="text-[11px] text-newTableText">
                  {font.weights.join(', ')}{font.italic ? ` · ${t('italic', 'italic')}` : ''}
                  {!fontServerRenderable(font) ? ` · ${t('designer_font_no_server_render', 'Not used in server-rendered exports (WOFF2)')}` : ''}
                </div>
              </div>
              {canEdit && <button onClick={() => deleteFont(font.fileId)} className="text-dangerText text-[12px]">{t('remove', 'Remove')}</button>}
            </div>
          ))}
        </div>
        {canEdit && (
          <>
            <input
              ref={fontInputRef}
              type="file"
              multiple
              accept=".ttf,.otf,.woff2"
              className="hidden"
              onChange={async (event) => {
                await uploadCustomFonts(Array.from(event.target.files || []));
                if (fontInputRef.current) fontInputRef.current.value = '';
                onSaved?.();
              }}
            />
            <button disabled={uploading} onClick={() => fontInputRef.current?.click()} className="self-start border border-dashed border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[12px] text-newTableText disabled:opacity-50">
              {uploading ? t('designer_uploading_ellipsis', 'Uploading...') : t('designer_upload_font_cta', '+ Upload font (.ttf, .otf, .woff2)')}
            </button>
          </>
        )}
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[13px]">{t('designer_intro_outro', 'Intro / Outro')}</div>
        {([
          { key: 'intro', value: introFileId, setValue: setIntroFileId, picker: introPicker },
          { key: 'outro', value: outroFileId, setValue: setOutroFileId, picker: outroPicker },
        ] as const).map(({ key, value, setValue, picker }) => (
          <div key={key} className="flex items-center gap-[8px]">
            <button disabled={!canEdit} onClick={picker.open} className="flex-1 text-start border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[13px] disabled:opacity-60">
              {fileById.get(value || '')?.name || (value ? t('brand_video_selected', '{{slot}} selected', { slot: key }) : t('choose_brand_video', 'Choose {{slot}} video…', { slot: key }))}
            </button>
            {canEdit && value && <button onClick={() => setValue(null)} className="text-dangerText">×</button>}
          </div>
        ))}
      </section>

      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">{t('brand_enforcement', 'Keep me on-brand')}</div>
          <div className="text-[12px] text-newTableText">{t('brand_enforcement_description_v2', "When on, you'll get a gentle heads-up before saving a design that uses colours or fonts outside your brand.")}</div>
        </div>
        <Slider value={enforcementEnabled ? 'on' : 'off'} onChange={(value) => canEdit && setEnforcementEnabled(value === 'on')} fill={true} />
      </section>

      {canEdit && (
        <div className="flex justify-end">
          <button disabled={saving} className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[14px] hover:opacity-90 disabled:opacity-50" onClick={save}>
            {saving ? t('saving', 'Saving...') : t('save', 'Save')}
          </button>
        </div>
      )}

      {logoPicker.element}
      {assetPicker.element}
      {introPicker.element}
      {outroPicker.element}
    </div>
  );
};
