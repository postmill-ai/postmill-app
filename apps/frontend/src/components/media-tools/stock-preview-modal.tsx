'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  StockPhotoItem,
  StockVideoItem,
  StockVectorItem,
  StockStickerItem,
  StockIconItem,
} from './stock.types';
import { SaveToFilesModal } from './save-to-files-modal';
import { openInDesigner } from '@gitroom/frontend/components/media-tools/open-in-designer';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Premium BYOK content packs mint a licensed download URL from the item id at
// import time (mint-then-ingest). Keep in sync with the backend registry.
const CONTENT_PACK_SOURCES = new Set(['magnific', 'vecteezy', 'adobe-stock', 'envato']);
const CONTENT_PACK_LABELS: Record<string, string> = {
  magnific: 'Magnific',
  vecteezy: 'Vecteezy',
  'adobe-stock': 'Adobe Stock',
  envato: 'Envato Elements',
};

interface StockPreviewModalProps {
  item: StockPhotoItem | StockVideoItem | StockVectorItem | StockStickerItem | StockIconItem;
  type: 'photo' | 'video' | 'vector' | 'sticker' | 'icon';
}

// Icons are SVG. `/files/import` intentionally rejects `image/svg+xml` (anti-XSS — never
// ingest raw SVG). To keep "Save to Files" functional for icons we rasterize the SVG to a
// PNG client-side and upload the raster instead (6.3g). Iconify's API sends `ACAO: *`, so the
// canvas stays untainted with `crossOrigin='anonymous'`.
async function rasterizeSvgUrlToPngBlob(url: string, size = 512): Promise<Blob> {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  const loaded = new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('icon load failed'));
  });
  img.src = url;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas context');

  const iw = img.naturalWidth || size;
  const ih = img.naturalHeight || size;
  const scale = Math.min(size / iw, size / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);

  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('rasterize failed'))),
      'image/png',
    ),
  );
}

export const StockPreviewModal: FC<StockPreviewModalProps> = ({ item: initialItem, type }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [posting, setPosting] = useState(false);

  // "Open in Designer" navigates to the full /media/designer page.
  // Images land on the static canvas (with attribution + sizing metadata);
  // video lands on the timeline.
  const handleOpenInDesigner = useCallback(() => {
    const operation = type === 'video' ? 'video' : 'image';
    modal.closeAll();
    openInDesigner(
      {
        operation,
        artifactUrl: item.url,
        source: item.source,
        author: item.author,
        authorUrl: item.authorUrl,
        downloadLocation:
          type === 'photo'
            ? (item as StockPhotoItem).downloadLocation || undefined
            : undefined,
        thumbUrl: type === 'video' ? (item as StockVideoItem).thumbUrl : item.thumbUrl,
        width: item.width,
        height: item.height,
        naturalWidth: item.width,
        naturalHeight: item.height,
      },
      router.push
    );
  }, [router, modal, item, type]);

  const relatedKey =
    type === 'photo'
      ? `stock-photos-${(item as StockPhotoItem).id}-related`
      : type === 'video'
      ? `stock-videos-${(item as StockVideoItem).id}-related`
      : null;

  const { data: related } = useSWR(
    relatedKey,
    async () => {
      const endpoint =
        type === 'photo'
          ? `/media/stock/photos/${(item as StockPhotoItem).id}/related`
          : `/media/stock/videos/${(item as StockVideoItem).id}/related`;
      const res = await fetch(endpoint);
      if (!res.ok) return [];
      return res.json();
    }
  );

  const handleSaveToFiles = useCallback(() => {
    let name: string;
    const source = item.source;
    let downloadLocation: string | undefined;

    switch (type) {
      case 'photo':
        name = `${source}-${item.id}.jpg`;
        downloadLocation = (item as StockPhotoItem).downloadLocation || undefined;
        break;
      case 'video':
        name = `${source}-${item.id}.mp4`;
        break;
      case 'vector':
        name = `${source}-${item.id}.jpg`;
        break;
      case 'sticker':
        name = `${source}-${item.id}.gif`;
        break;
      case 'icon': {
        // Saved as a rasterized PNG (see uploadBlob below) — SVG is rejected by /files/import.
        const icon = item as StockIconItem;
        name = `${source}-${icon.prefix}-${icon.iconName}.png`;
        break;
      }
      default:
        name = `stock-${item.id}`;
    }

    // Premium content packs mint a licensed download URL from the item id.
    if (CONTENT_PACK_SOURCES.has(source)) {
      downloadLocation = item.id;
    }

    modal.closeAll();
    modal.openModal({
      title: '',
      closeOnClickOutside: true,
      closeOnEscape: true,
      withCloseButton: true,
      classNames: { modal: 'w-[100%] max-w-[600px] text-textColor' },
      children: (
        <SaveToFilesModal
          url={item.url}
          name={name}
          source={source}
          type={type}
          downloadLocation={downloadLocation}
          attribution={item.attribution}
          uploadBlob={type === 'icon' ? () => rasterizeSvgUrlToPngBlob(item.url) : undefined}
        />
      ),
      size: 'lg',
    });
  }, [modal, item, type]);

  // Stickers' real home is a post, not the Designer (which flattens the
  // animation to frame 1). Save the original animated file, then open the
  // composer with it pre-attached — animation survives all the way to publish.
  const handleSaveAndPost = useCallback(async () => {
    if (posting) return;
    setPosting(true);
    try {
      const name = `${item.source}-${item.id}.gif`;
      const res = await fetch('/files/import', {
        method: 'POST',
        body: JSON.stringify({
          url: item.url,
          name,
          source: item.source,
          type,
          attribution: item.attribution,
        }),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        toaster.show(msg || t('could_not_save_item', 'Could not save this item'), 'warning');
        return;
      }
      const savedFile = await res.json();
      const integrationsRes = await fetch('/integrations');
      const integrations = integrationsRes.ok ? await integrationsRes.json() : [];
      const { Composer } = await import(
        '@gitroom/frontend/components/composer/composer'
      );
      const dayjs = (await import('dayjs')).default;
      modal.closeAll();
      modal.openModal({
        fullScreen: true,
        removeLayout: true,
        children: (
          <Composer
            date={dayjs()}
            integrations={integrations}
            allIntegrations={integrations}
            onlyValues={[
              { content: '', id: 'new', image: [{ id: savedFile.id, path: savedFile.path }] },
            ]}
            mutate={() => {}}
            reopenModal={() => {}}
          />
        ),
      });
    } catch {
      toaster.show(t('could_not_save_item', 'Could not save this item'), 'warning');
    } finally {
      setPosting(false);
    }
  }, [posting, fetch, modal, toaster, item, type, t]);

  const renderPreview = () => {
    if (type === 'video') {
      return (
        <video
          src={(item as StockVideoItem).url}
          poster={(item as StockVideoItem).thumbUrl}
          controls
          className="w-full rounded-[8px] max-h-[60vh]"
          aria-label={t('stock_video_preview_aria', 'Stock video preview')}
        >
          <track kind="captions" srcLang="en" label="English" />
        </video>
      );
    }
    if (type === 'icon') {
      // Monochrome currentColor SVG — paint it as a theme-coloured mask so it's
      // visible in dark mode (an <img> would render it black).
      return (
        <div className="w-full rounded-[8px] flex items-center justify-center p-[48px] bg-newBgColorInner">
          <span
            role="img"
            aria-label={item.description || ''}
            className="w-[160px] h-[160px] bg-textColor"
            style={{
              maskImage: `url("${item.url}")`,
              WebkitMaskImage: `url("${item.url}")`,
              maskRepeat: 'no-repeat',
              WebkitMaskRepeat: 'no-repeat',
              maskPosition: 'center',
              WebkitMaskPosition: 'center',
              maskSize: 'contain',
              WebkitMaskSize: 'contain',
            }}
          />
        </div>
      );
    }
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external stock preview
      <img
        src={item.url}
        alt={item.description || ''}
        className="w-full rounded-[8px] max-h-[60vh] object-contain"
      />
    );
  };

  const sourceBadgeLabel =
    {
      unsplash: 'Unsplash',
      pexels: 'Pexels',
      pixabay: 'Pixabay',
      giphy: 'GIPHY',
      iconify: 'Iconify',
      ...CONTENT_PACK_LABELS,
    }[item.source] || item.source;

  const renderAttributionLine = () => {
    if (type === 'icon') {
      const icon = item as StockIconItem;
      const requiresAttribution = /cc-by/i.test(icon.license);
      return (
        <div className="text-[12px] text-newTextColor/60">
          {icon.prefix} · {t('license_label', 'License:')} {icon.license}
          {requiresAttribution && (
            <>
              {' · '}
              {t('attribution_required', 'Attribution required')}
            </>
          )}
        </div>
      );
    }

    if (item.source === 'pixabay') {
      return (
        <div className="text-[12px] text-newTextColor/60">
          {t('powered_by', 'Powered by')}{' '}
          <a
            href="https://pixabay.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-btnPrimaryAccent hover:underline"
          >
            Pixabay
          </a>
        </div>
      );
    }

    if (item.source === 'giphy') {
      return <div className="text-[12px] text-newTextColor/60">{t('powered_by_giphy', 'Powered by GIPHY')}</div>;
    }

    if (CONTENT_PACK_SOURCES.has(item.source)) {
      return (
        <div className="text-[12px] text-newTextColor/60">
          {CONTENT_PACK_LABELS[item.source] || item.source} (BYOK) ·{' '}
          {item.license || t('premium_content_pack', 'Premium content pack')}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="flex flex-col gap-[20px] max-w-4xl">
      <div className="flex gap-[20px]">
        <div className="flex-1 min-w-0">{renderPreview()}</div>
        <div className="w-[240px] shrink-0 flex flex-col gap-[12px]">
          <div className="text-[12px] text-newTextColor/60 uppercase tracking-wider font-[600]">
            {type === 'photo'
              ? t('photo', 'Photo')
              : type === 'video'
              ? t('provider_chip_video', 'Video')
              : type === 'vector'
              ? t('vector', 'Vector')
              : type === 'sticker'
              ? t('sticker', 'Sticker')
              : t('icon', 'Icon')}
          </div>
          <div className="text-[13px] text-textColor">
            {item.width} × {item.height}
          </div>
          <div className="text-[13px] text-textColor">
            {t('by', 'by')}{' '}
            <a
              href={item.authorUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-btnPrimaryAccent hover:underline"
            >
              {item.author}
            </a>
          </div>
          <div className="flex gap-[8px] items-center">
            <span className="px-[8px] py-[2px] rounded-[4px] bg-[#2B5CD3]/20 text-[11px] text-btnPrimaryAccent font-[500]">
              {sourceBadgeLabel}
            </span>
          </div>
          {renderAttributionLine()}
          <div className="text-[12px] text-newTextColor/60">{item.description}</div>
          {type === 'sticker' ? (
            <button
              onClick={handleSaveAndPost}
              disabled={posting}
              className="px-[16px] py-[10px] rounded-[8px] bg-green-600 text-white text-[13px] font-[500] hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-[6px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              {posting ? t('saving_ellipsis', 'Saving…') : t('save_and_post', 'Save & Post')}
            </button>
          ) : (
            <button
              onClick={handleOpenInDesigner}
              className="px-[16px] py-[10px] rounded-[8px] bg-green-600 text-white text-[13px] font-[500] hover:bg-green-700 transition-all flex items-center gap-[6px]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
              </svg>
              {t('open_in_designer', 'Open in Designer')}
            </button>
          )}
          <button
            onClick={handleSaveToFiles}
            className="px-[16px] py-[10px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[500] hover:bg-[#2B5CD3]/80 transition-all flex items-center gap-[6px]"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
            </svg>
            {t('save_to_files', 'Save to Files')}
          </button>
        </div>
      </div>

      {related && related.length > 0 && (
        <div>
          <div className="text-[14px] font-[600] text-textColor mb-[12px]">{t('related', 'Related')}</div>
          <div className="flex gap-[10px] overflow-x-auto pb-[8px]">
            {(related.results || related).slice(0, 8).map((rel: any) => (
              <button
                key={rel.id}
                type="button"
                onClick={() => setItem(rel)}
                className="w-[120px] shrink-0 cursor-pointer rounded-[6px] overflow-hidden border border-newBorder hover:border-[#2B5CD3] transition-all"
              >
                <div className="aspect-square">
                  {/* eslint-disable-next-line @next/next/no-img-element -- external stock thumbnail */}
                  <img
                    src={rel.thumbUrl}
                    alt={rel.description || ''}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
