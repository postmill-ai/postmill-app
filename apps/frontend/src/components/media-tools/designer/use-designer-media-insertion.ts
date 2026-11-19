'use client';

import { useCallback } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useImportStockMedia } from '@postmill-ai/frontend/components/media-tools/media-import';
import type { MediaSelectorItem } from '@postmill-ai/frontend/components/media-tools/media-selector-modal';
import { addImageClipToTimeline, addMediaToTimeline, timelineMediaTypeForPick } from './add-media-to-timeline';
import { addImageElementFromMedia, type MediaPoint } from './insert-image';
import type { createDesignerStore } from './designer.store';

export type DesignerMediaKind = 'image' | 'sticker' | 'vector' | 'icon' | 'video' | 'audio';
export type InsertDesignerMedia = (
  kind: DesignerMediaKind,
  item: MediaSelectorItem,
  at?: MediaPoint
) => Promise<void>;

type Store = ReturnType<typeof createDesignerStore>;

export const useDesignerMediaInsertion = (store: Store): InsertDesignerMedia => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const importStockMedia = useImportStockMedia();

  return useCallback(async (kind, item, at) => {
    let resolved = item;
    if (kind === 'vector' && item.source === 'stock') {
      try {
        resolved = await importStockMedia(item);
      } catch (error) {
        toaster.show((error as Error).message || t('import_failed', 'Import failed'), 'warning');
        return;
      }
    }

    const timelineType = timelineMediaTypeForPick(kind, resolved.type);
    if (store.getState().doc.mode !== 'video' && (timelineType === 'video' || timelineType === 'audio')) {
      if (kind === 'sticker' && timelineType === 'video' && resolved.thumbnail) {
        addImageElementFromMedia(store, {
          ...resolved, url: resolved.thumbnail, width: undefined, height: undefined, at,
        });
      } else {
        toaster.show(
          t('designer_media_requires_video_design', 'This media requires a video design. Your image design has not been changed.'),
          'warning'
        );
      }
      return;
    }

    if (timelineType === 'video' || timelineType === 'audio') {
      try {
        const landed = await addMediaToTimeline(store, {
          type: timelineType,
          url: resolved.url,
          fileId: resolved.fileId,
          width: resolved.width,
          height: resolved.height,
          sticker: kind === 'sticker',
          at,
        });
        if (landed?.probeFailed) {
          toaster.show(
            t('couldnt_read_video_metadata', "Couldn't read the video's metadata — placed with a default duration"),
            'warning'
          );
        }
      } catch {
        toaster.show(t('couldnt_add_to_timeline', "Couldn't add that to the timeline"), 'warning');
      }
      return;
    }

    if (store.getState().doc.mode === 'video') {
      addImageClipToTimeline(store, {
        url: resolved.url,
        fileId: resolved.fileId,
        width: resolved.width,
        height: resolved.height,
        square: kind === 'icon',
        at,
      });
      return;
    }

    if (kind === 'icon') {
      const name = /\/([a-z0-9-]+)\/([a-z0-9-]+)\.svg/.exec(resolved.url);
      const icon = name
        ? await fetch(`/media/icons/resolve?name=${encodeURIComponent(`${name[1]}:${name[2]}`)}`)
            .then((response) => (response.ok ? response.json() : null))
            .catch(() => null)
        : null;
      if (!icon?.body) {
        toaster.show(t('couldnt_add_icon', "Couldn't add that icon"), 'warning');
        return;
      }
      const state = store.getState();
      const active = state.doc.outputs[state.currentOutput];
      const size = Math.round(Math.min(active.width, active.height) * 0.2);
      state.addElement({
        id: '',
        type: 'icon',
        x: at ? at.x - size / 2 : (active.width - size) / 2,
        y: at ? at.y - size / 2 : (active.height - size) / 2,
        width: size,
        height: size,
        rotation: 0,
        opacity: 1,
        locked: false,
        hidden: false,
        src: icon.body,
        viewBox: icon.viewBox,
        fill: '#2B5CD3',
      } as never);
      return;
    }

    addImageElementFromMedia(store, { ...resolved, at });
  }, [fetch, importStockMedia, store, t, toaster]);
};
