'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Slider } from '@gitroom/react/form/slider';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';

interface BrandAsset {
  fileId?: string;
  url: string;
  caption?: string;
}

interface BrandAssetsInitial {
  palette?: string[];
  assets?: BrandAsset[];
  enforcement?: { enabled?: boolean } & Record<string, any>;
}

export const BrandAssets = ({
  brandId,
  initial,
  onSaved,
}: {
  brandId: string;
  initial?: BrandAssetsInitial;
  onSaved?: () => void;
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [palette, setPalette] = useState<string[]>(
    Array.isArray(initial?.palette) ? (initial!.palette as string[]) : []
  );
  const [assets, setAssets] = useState<BrandAsset[]>(
    Array.isArray(initial?.assets) ? (initial!.assets as BrandAsset[]) : []
  );
  const [enforcementEnabled, setEnforcementEnabled] = useState(
    !!initial?.enforcement?.enabled
  );
  const [newColor, setNewColor] = useState('#2B5CD3');
  const [showMedia, setShowMedia] = useState(false);
  const [saving, setSaving] = useState(false);

  const addColor = useCallback(() => {
    const c = newColor.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(c) && !palette.includes(c)) {
      setPalette((p) => [...p, c]);
    }
  }, [newColor, palette]);

  const handleAssetSelect = useCallback(
    async (item: { source: string; url: string; fileId?: string; type: string }) => {
      setShowMedia(false);
      if (item.type !== 'image') {
        toaster.show(t('brand_assets_image_only', 'Brand assets must be images'), 'warning');
        return;
      }
      let fileId = item.fileId;
      let url = item.url;
      // Stock picks aren't Files yet — import so the asset persists.
      if (!fileId) {
        const res = await fetch('/files/import', {
          method: 'POST',
          body: JSON.stringify({ url: item.url, name: 'brand-asset', type: 'image' }),
        });
        if (res.ok) {
          const f = await res.json();
          fileId = f.id;
          url = f.path || item.url;
        }
      }
      setAssets((a) => [...a, { fileId, url, caption: '' }]);
    },
    [fetch, toaster, t]
  );

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/brands/${brandId}`, {
        method: 'PUT',
        body: JSON.stringify({
          palette,
          assets,
          enforcement: { ...(initial?.enforcement || {}), enabled: enforcementEnabled },
        }),
      });
      if (!res.ok) {
        toaster.show(t('brand_assets_save_failed', 'Failed to save brand assets'), 'warning');
        return;
      }
      toaster.show(t('brand_assets_saved', 'Brand assets saved'), 'success');
      onSaved?.();
    } finally {
      setSaving(false);
    }
  }, [brandId, palette, assets, enforcementEnabled, initial, fetch, toaster, t, onSaved]);

  return (
    <div className="my-[16px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[24px]">
      <div className="flex flex-col">
        <div className="text-[14px]">{t('brand_assets', 'Brand Kit')}</div>
        <div className="text-[12px] text-newTableText">
          {t('brand_assets_description_v2', 'Your logo, colours, and reference pictures. When you make graphics in the Designer, it uses these so everything looks like you.')}
        </div>
      </div>

      {/* Colour palette */}
      <div className="flex flex-col gap-[10px]">
        <div className="text-[13px]">{t('color_palette', 'Your brand colours')}</div>
        <div className="text-[12px] text-newTableText">
          {t('color_palette_hint', 'Add the colours you use. Click the swatch to pick one, or paste a colour code like #2B5CD3.')}
        </div>
        <div className="flex flex-wrap items-center gap-[8px]">
          {palette.map((c) => (
            <div
              key={c}
              className="group/sw relative w-[36px] h-[36px] rounded-[8px] border border-newTableBorder"
              style={{ backgroundColor: c }}
              title={c}
            >
              <button
                onClick={() => setPalette((p) => p.filter((x) => x !== c))}
                aria-label={`Remove ${c}`}
                className="absolute -top-[6px] -right-[6px] w-[16px] h-[16px] rounded-full bg-newBgColorInner border border-newTableBorder text-[10px] text-dangerText opacity-0 group-hover/sw:opacity-100 transition-opacity flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}
          {palette.length === 0 && (
            <span className="text-[12px] text-newTableText">{t('no_colors_yet', 'No colours yet')}</span>
          )}
        </div>
        <div className="flex items-center gap-[8px]">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label="Brand color"
            className="w-[36px] h-[32px] rounded-[6px] border border-newTableBorder bg-transparent cursor-pointer p-0"
          />
          <input
            type="text"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            aria-label="Hex color value"
            className="w-[110px] bg-newBgColor border border-newTableBorder rounded-[8px] px-[10px] py-[6px] text-[13px] text-textColor outline-none"
          />
          <button
            onClick={addColor}
            className="text-[12px] text-btnPrimaryAccent hover:underline"
          >
            {t('add_color', 'Add colour')}
          </button>
        </div>
      </div>

      {/* Attached assets */}
      <div className="flex flex-col gap-[10px]">
        <div className="text-[13px]">{t('attached_assets', 'Logos & pictures')}</div>
        <div className="text-[12px] text-newTableText">
          {t('attached_assets_hint', 'Upload your logo and any images you want on hand — product photos, your mascot, screenshots. You can drop them into designs later.')}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-[12px]">
          {assets.map((a, i) => (
            <div
              key={a.fileId || a.url || i}
              className="border border-newTableBorder rounded-[10px] overflow-hidden bg-newBgColor flex flex-col"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={a.url} alt={a.caption || ''} className="w-full h-[100px] object-cover" />
              <div className="p-[8px] flex flex-col gap-[6px]">
                <input
                  type="text"
                  value={a.caption || ''}
                  onChange={(e) =>
                    setAssets((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, caption: e.target.value } : x))
                    )
                  }
                  placeholder={t('caption_optional', 'Caption (optional)')}
                  className="w-full bg-newBgColorInner border border-newTableBorder rounded-[6px] px-[8px] py-[5px] text-[12px] text-textColor outline-none"
                />
                <button
                  onClick={() => setAssets((list) => list.filter((_, idx) => idx !== i))}
                  className="text-[11px] text-dangerText hover:underline self-start"
                >
                  {t('remove', 'Remove')}
                </button>
              </div>
            </div>
          ))}
          <button
            onClick={() => setShowMedia(true)}
            className="border border-dashed border-newTableBorder rounded-[10px] h-[100px] flex flex-col items-center justify-center gap-[6px] text-[12px] text-newTableText hover:bg-boxHover transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('add_asset', 'Add asset')}
          </button>
        </div>
      </div>

      {/* Enforcement */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">{t('brand_enforcement', 'Keep me on-brand')}</div>
          <div className="text-[12px] text-newTableText">
            {t('brand_enforcement_description_v2', "When on, you'll get a gentle heads-up before saving a design that uses colours or fonts outside your brand.")}
          </div>
        </div>
        <Slider
          value={enforcementEnabled ? 'on' : 'off'}
          onChange={(value) => setEnforcementEnabled(value === 'on')}
          fill={true}
        />
      </div>

      <div className="flex justify-end">
        <button
          disabled={saving}
          className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[14px] hover:opacity-90 disabled:opacity-50"
          onClick={save}
        >
          {saving ? t('saving', 'Saving...') : t('save', 'Save')}
        </button>
      </div>

      <MediaSelectorModal
        open={showMedia}
        onClose={() => setShowMedia(false)}
        onSelect={handleAssetSelect}
      />
    </div>
  );
};
