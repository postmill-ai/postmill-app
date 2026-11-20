'use client';

import React, { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { Slider } from '@postmill-ai/react/form/slider';
import { useMediaPicker } from '@postmill-ai/frontend/components/media-tools/use-media-picker';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { OverflowTabs } from '@postmill-ai/frontend/components/ui/overflow-tabs';
import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';
import type { BrandColorRole, BrandLogoRole } from '@postmill-ai/nestjs-libraries/brands/brand-kit';
import {
  fontServerRenderable,
  useCustomFonts,
  useUploadCustomFont,
} from '@postmill-ai/frontend/components/media-tools/designer/panels/use-brand-fonts';
import { FontCatalogPicker } from '@postmill-ai/frontend/components/media-tools/designer/panels/font-catalog-picker';
import type { Brand, BrandAsset } from './use-brands';
import { withBrandColorRoles, withBrandLogoRoles } from './brand-visual-fields';
import { BrandTemplates } from './brand-templates';

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

type PaletteEntry = { hex: string; role?: BrandColorRole };

const SECTION_CLASS = 'scroll-mt-[80px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]';
const COLOR_ROLES: Array<{ value: BrandColorRole; label: string }> = [
  { value: 'primary', label: 'Primary' },
  { value: 'accent', label: 'Accent' },
  { value: 'background', label: 'Background' },
  { value: 'text', label: 'Text' },
];
const LOGO_ROLES: Array<{ value: BrandLogoRole; label: string }> = [
  { value: 'main', label: 'Main' },
  { value: 'icon', label: 'Icon' },
  { value: 'dark', label: 'Dark version' },
];

const BrandKitSection = ({ id, title, description, children }: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) => (
  <section id={id} className={SECTION_CLASS}>
    <div>
      <div className="text-[14px]">{title}</div>
      {description && <div className="text-[12px] text-newTableText mt-[4px]">{description}</div>}
    </div>
    {children}
  </section>
);

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
  const [palette, setPalette] = useState<PaletteEntry[]>(() => (initial?.palette || []).map((hex, index) => ({
    hex,
    role: initial?.colorRoles?.find((assignment) => assignment.index === index)?.role,
  })));
  const [assets, setAssets] = useState<BrandAsset[]>(initial?.assets || []);
  const [logoFileIds, setLogoFileIds] = useState<string[]>(initial?.logoFileIds || []);
  const [logoRoles, setLogoRoles] = useState<Partial<Record<string, BrandLogoRole>>>(() =>
    Object.fromEntries((initial?.logoRoles || []).map((assignment) => [assignment.fileId, assignment.role]))
  );
  const [logoTargetRole, setLogoTargetRole] = useState<BrandLogoRole | null>(null);
  const [fontFamilies, setFontFamilies] = useState<string[]>(initial?.fontFamilies || []);
  const [preferredFormats, setPreferredFormats] = useState<string[]>(initial?.preferredFormats || []);
  const [introFileId, setIntroFileId] = useState<string | null>(initial?.introFileId || null);
  const [outroFileId, setOutroFileId] = useState<string | null>(initial?.outroFileId || null);
  const [enforcementEnabled, setEnforcementEnabled] = useState(!!initial?.enforcement?.enabled);
  const [newColor, setNewColor] = useState('#2B5CD3');
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState('colors');
  const fontInputRef = useRef<HTMLInputElement>(null);
  const { fonts: customFonts, mutate: mutateCustomFonts } = useCustomFonts(brandId);
  const { uploadMany: uploadCustomFonts, uploading } = useUploadCustomFont(brandId);

  const sections = useMemo(() => [
    { key: 'colors', label: t('brand_kit_section_colors', 'Colors') },
    { key: 'fonts', label: t('brand_kit_section_fonts', 'Fonts') },
    { key: 'logos', label: t('brand_kit_section_logos', 'Logos') },
    { key: 'images', label: t('brand_kit_section_images', 'Images') },
    { key: 'formats', label: t('brand_kit_section_formats', 'Formats') },
    { key: 'templates', label: t('brand_kit_section_templates', 'Templates') },
  ], [t]);

  useEffect(() => {
    const openHash = () => {
      const key = window.location.hash.slice(1);
      if (!sections.some((section) => section.key === key)) return;
      setActiveSection(key);
      requestAnimationFrame(() => document.getElementById(key)?.scrollIntoView({ block: 'start' }));
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    return () => window.removeEventListener('hashchange', openHash);
  }, [sections]);

  const currentSnapshot = useMemo(() => JSON.stringify({
    palette,
    assets,
    logoFileIds,
    logoRoles,
    fontFamilies,
    preferredFormats,
    introFileId,
    outroFileId,
    enforcementEnabled,
  }), [palette, assets, logoFileIds, logoRoles, fontFamilies, preferredFormats, introFileId, outroFileId, enforcementEnabled]);
  const [savedSnapshot, setSavedSnapshot] = useState(currentSnapshot);
  const isDirty = currentSnapshot !== savedSnapshot;

  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isDirty]);

  const referencedFileIds = useMemo(() => [...new Set([
    ...logoFileIds,
    introFileId,
    outroFileId,
  ].filter((id): id is string => !!id))].sort(), [logoFileIds, introFileId, outroFileId]);
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
  const addColor = useCallback(() => {
    const hex = newColor.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(hex) && !palette.some((entry) => entry.hex === hex)) {
      setPalette((current) => [...current, { hex }]);
    }
  }, [newColor, palette]);

  const assignLogoRole = useCallback((fileId: string, role?: BrandLogoRole) => {
    setLogoRoles((current) => {
      const next = Object.fromEntries(Object.entries(current).filter(([id, assigned]) =>
        id !== fileId && assigned !== role
      )) as Partial<Record<string, BrandLogoRole>>;
      if (role) next[fileId] = role;
      return next;
    });
  }, []);

  const removeLogo = useCallback((fileId: string) => {
    setLogoFileIds((current) => current.filter((id) => id !== fileId));
    setLogoRoles((current) => {
      const next = { ...current };
      delete next[fileId];
      return next;
    });
  }, []);

  const logoPicker = useMediaPicker({
    title: t('brand_logo', 'Brand logo'),
    kinds: ['image'],
    requireFile: true,
    importName: 'brand-logo',
    onSelect: (item) => {
      if (!item.fileId) return;
      const selectedId = item.fileId;
      if (logoTargetRole) {
        setLogoFileIds((current) => {
          const previousIndex = current.findIndex((id) => logoRoles[id] === logoTargetRole);
          if (previousIndex < 0) return current.includes(selectedId) ? current : [...current, selectedId];
          const previousId = current[previousIndex];
          const next = current.filter((id) => id !== previousId && id !== selectedId);
          next.splice(Math.min(previousIndex, next.length), 0, selectedId);
          return next;
        });
        assignLogoRole(selectedId, logoTargetRole);
      } else {
        setLogoFileIds((current) => current.includes(selectedId) ? current : [...current, selectedId]);
      }
      setLogoTargetRole(null);
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
          palette: withBrandColorRoles(
            palette.map((entry) => entry.hex),
            palette.flatMap((entry, index) => entry.role ? [{ index, hex: entry.hex, role: entry.role }] : []),
          ),
          assets,
          logoFileIds: withBrandLogoRoles(
            logoFileIds,
            Object.entries(logoRoles).flatMap(([fileId, role]) => role ? [{ fileId, role }] : []),
          ),
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
      setSavedSnapshot(currentSnapshot);
      toaster.show(t('brand_assets_saved', 'Brand assets saved'), 'success');
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [brandId, canEdit, palette, assets, logoFileIds, logoRoles, fontFamilies, preferredFormats, introFileId, outroFileId, enforcementEnabled, initial?.enforcement, currentSnapshot, fetch, toaster, t, onSaved]);

  const addFontFamily = useCallback((family: string) => {
    setFontFamilies((current) => current.includes(family) ? current : [...current, family]);
  }, []);

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

  const openLogoRole = (role: BrandLogoRole) => {
    setLogoTargetRole(role);
    logoPicker.open();
  };

  const renderLogoCard = (fileId: string, label: string, role?: BrandLogoRole) => {
    const file = fileById.get(fileId);
    return (
      <div key={fileId} className="border border-newTableBorder rounded-[10px] bg-newBgColor p-[8px] flex flex-col gap-[6px]">
        <div className="aspect-square flex items-center justify-center overflow-hidden">
          {file ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={file.path} alt={file.name} className="w-full h-full object-contain p-[4px]" />
          ) : <span className="text-[11px] text-newTableText break-all">{fileId}</span>}
        </div>
        <div className="text-[12px] font-[500]">{role ? label : file?.name || t('brand_logo_unassigned', 'Unassigned logo')}</div>
        {canEdit && (
          <div className="flex flex-wrap items-center gap-[6px] text-[11px]">
            {role && <button onClick={() => openLogoRole(role)} className="text-btnPrimaryAccent hover:underline">{t('replace', 'Replace')}</button>}
            {role
              ? <button onClick={() => assignLogoRole(fileId)} className="text-newTableText hover:underline">{t('brand_logo_clear_role', 'Clear role')}</button>
              : (
                <select
                  value=""
                  aria-label={t('brand_logo_role_for', 'Logo role for {{name}}', {
                    name: file?.name || fileId,
                    interpolation: { escapeValue: false },
                  })}
                  onChange={(event) => assignLogoRole(fileId, (event.target.value || undefined) as BrandLogoRole | undefined)}
                  className="max-w-full bg-newBgColorInner border border-newTableBorder rounded-[6px] px-[4px] py-[3px] text-textColor"
                >
                  <option value="">{t('brand_logo_assign_role', 'Assign role')}</option>
                  {LOGO_ROLES.map((option) => <option key={option.value} value={option.value}>{t(`brand_logo_role_${option.value}`, option.label)}</option>)}
                </select>
              )}
            <button onClick={() => removeLogo(fileId)} aria-label={t('brand_logo_remove_named', 'Remove {{label}} logo', { label })} className="text-dangerText hover:underline">{t('remove', 'Remove')}</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="my-[16px] flex flex-col gap-[16px]">
      <section className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px]">
        <div className="text-[14px]">{t('brand_assets', 'Brand Kit')}</div>
        <div className="text-[12px] text-newTableText mt-[4px]">
          {t('brand_assets_description_v3', 'The visual source of truth for this brand. Designer and AI Designer use these colors, fonts, logos, images, formats, and templates.')}
        </div>
      </section>

      <div className="sticky top-0 z-20 bg-newBgColor py-[4px]">
        <OverflowTabs
          items={sections.map((section) => ({
            ...section,
            href: `/brands/${brandId}/kit#${section.key}`,
          }))}
          activeKey={activeSection}
          variant="outline"
          semantics="nav"
          ariaLabel={t('brand_kit_more_sections', 'More Brand Kit sections')}
          listAriaLabel={t('brand_kit_sections', 'Brand Kit sections')}
        />
      </div>

      <BrandKitSection
        id="colors"
        title={t('color_palette', 'Your brand colours')}
        description={t('brand_color_roles_hint', 'Optionally tell AI Designer how to use each colour. Colours can share a role as ordered choices; unassigned colours stay in the palette.')}
      >
        <div className="flex flex-wrap items-start gap-[10px]">
          {palette.map((entry, index) => (
            <div key={`${entry.hex}-${index}`} className="group/sw relative flex flex-col items-center gap-[5px] w-[104px]">
              <div className="w-[36px] h-[36px] rounded-[8px] border border-newTableBorder" style={{ backgroundColor: entry.hex }} title={entry.hex} />
              <div className="text-[11px] text-newTableText">{entry.hex}</div>
              <select
                value={entry.role || ''}
                disabled={!canEdit}
                aria-label={t('brand_color_role_for', 'Colour role for {{color}}', { color: entry.hex })}
                onChange={(event) => setPalette((current) => current.map((color, colorIndex) => colorIndex === index
                  ? { ...color, role: (event.target.value || undefined) as BrandColorRole | undefined }
                  : color))}
                className="w-full bg-newBgColor border border-newTableBorder rounded-[6px] px-[5px] py-[4px] text-[11px] text-textColor disabled:opacity-60"
              >
                <option value="">{t('brand_role_unassigned', 'No role')}</option>
                {COLOR_ROLES.map((role) => <option key={role.value} value={role.value}>{t(`brand_color_role_${role.value}`, role.label)}</option>)}
              </select>
              {canEdit && (
                <button
                  onClick={() => setPalette((current) => current.filter((_, colorIndex) => colorIndex !== index))}
                  aria-label={`Remove ${entry.hex}`}
                  className="absolute top-[-6px] end-[-2px] w-[16px] h-[16px] rounded-full bg-newBgColorInner border border-newTableBorder text-[10px] text-dangerText opacity-0 group-hover/sw:opacity-100 focus:opacity-100 transition-opacity flex items-center justify-center"
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
      </BrandKitSection>

      <BrandKitSection id="fonts" title={t('brand_fonts', 'Brand fonts')}>
        <div className="flex flex-wrap gap-[8px]">
          {fontFamilies.map((family) => (
            <span key={family} className="inline-flex items-center gap-[6px] border border-newTableBorder rounded-[6px] px-[8px] py-[5px] text-[12px]" style={{ fontFamily: `"${family}"` }}>
              {family}
              {canEdit && <button onClick={() => setFontFamilies((current) => current.filter((entry) => entry !== family))} aria-label={t('remove_font_family', 'Remove {{family}}', { family })}>×</button>}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className="w-full max-w-[360px]">
            <FontCatalogPicker
              value=""
              placeholder={t('brand_font_catalog_placeholder', 'Search and add a font…')}
              onPick={addFontFamily}
              customFonts={customFonts}
              selectedFamilies={fontFamilies}
            />
          </div>
        )}
        <div className="flex flex-col gap-[8px]">
          {customFonts.map((font) => (
            <div key={font.fileId} className="flex items-center justify-between border border-newTableBorder rounded-[8px] px-[12px] py-[8px]">
              <div>
                <div className="text-[13px]" style={{ fontFamily: `"${font.family}"` }}>{font.family}</div>
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
      </BrandKitSection>

      <BrandKitSection
        id="logos"
        title={t('brand_logos', 'Logos')}
        description={t('brand_logo_roles_hint', 'Label the main, icon, and dark-version logos. Other logos stay available as unassigned.')}
      >
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px]">
          {LOGO_ROLES.map(({ value: role, label }) => {
            const fileId = logoFileIds.find((id) => logoRoles[id] === role);
            if (fileId) return renderLogoCard(fileId, t(`brand_logo_role_${role}`, label), role);
            return canEdit ? (
              <button key={role} onClick={() => openLogoRole(role)} className="border border-dashed border-newTableBorder rounded-[10px] min-h-[132px] flex flex-col items-center justify-center gap-[6px] text-[12px] text-newTableText hover:bg-boxHover">
                <span className="text-[18px]">+</span>
                <span>{t('brand_logo_add_role', 'Add {{label}} logo', { label: t(`brand_logo_role_${role}`, label) })}</span>
              </button>
            ) : null;
          })}
        </div>
        <div className="flex flex-col gap-[8px]">
          <div className="text-[12px] text-newTableText">{t('brand_logos_additional', 'Additional logos')}</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
            {logoFileIds.filter((fileId) => !logoRoles[fileId]).map((fileId) => renderLogoCard(fileId, t('brand_logo_unassigned', 'Unassigned logo')))}
            {canEdit && (
              <button onClick={() => { setLogoTargetRole(null); logoPicker.open(); }} className="border border-dashed border-newTableBorder rounded-[10px] min-h-[112px] flex items-center justify-center text-[12px] text-newTableText hover:bg-boxHover">
                {t('add_logo', 'Add logo')}
              </button>
            )}
          </div>
        </div>
      </BrandKitSection>

      <BrandKitSection
        id="images"
        title={t('attached_assets', 'Reference images')}
        description={t('reference_images_hint', 'Product photos, mascots, screenshots, and other imagery the Designer and AI Designer can use as references.')}
      >
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
      </BrandKitSection>

      <BrandKitSection
        id="formats"
        title={t('preferred_formats', 'Preferred formats')}
        description={t('preferred_formats_hint', 'These formats appear first for this brand. They are defaults, not restrictions.')}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[8px]">
          {CHANNEL_PRESETS.filter((preset) => preset.id !== 'custom').map((preset) => (
            <label key={preset.id} className="flex items-center gap-[8px] text-[12px] text-textColor">
              <input type="checkbox" checked={preferredFormats.includes(preset.id)} disabled={!canEdit} onChange={() => toggleFormat(preset.id)} />
              <span>{preset.name}</span>
              <span className="text-newTableText">{preset.width}×{preset.height}</span>
            </label>
          ))}
        </div>
        <div className="border-t border-newTableBorder pt-[16px] text-[13px]">{t('designer_intro_outro', 'Intro / Outro')}</div>
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
      </BrandKitSection>

      <BrandTemplates brandId={brandId} canEdit={canEdit} />

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
        <div className="flex items-center justify-end gap-[12px]">
          <span role="status" className="text-[12px] text-newTableText">
            {isDirty ? t('brand_kit_unsaved_changes', 'Unsaved changes') : t('brand_kit_all_changes_saved', 'All changes saved')}
          </span>
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
