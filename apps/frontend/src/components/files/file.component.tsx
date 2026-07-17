'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Button } from '@gitroom/react/form/button';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { VideoFrame } from '@gitroom/react/helpers/video.frame';
import dynamic from 'next/dynamic';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { usePermissions } from '@gitroom/frontend/components/layout/use-permissions';
import { AiImage } from '@gitroom/frontend/components/launches/ai.image';
import { useMediaToolsStatus } from '@gitroom/frontend/components/layout/use-media-tools-status';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import { ReactSortable } from 'react-sortablejs';
import { MediaComponentInner } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { AiVideo } from '@gitroom/frontend/components/launches/ai.video';
import { AiBestTime } from '@gitroom/frontend/components/launches/ai.best-time';
import { AiContentTools } from '@gitroom/frontend/components/launches/ai.content.tools';
import { AiPromptLibraryInsert } from '@gitroom/frontend/components/launches/ai.prompt-library.insert';
import { AiSearch } from '@gitroom/frontend/components/launches/ai.search';
import {
  ToolbarDropdown,
  MenuItem,
  SparkleIcon,
} from '@gitroom/frontend/components/composer/toolbar-dropdown';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseCircleIcon,
  DragHandleIcon,
  MediaSettingsIcon,
  InsertMediaIcon,
  VerticalDividerIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { useShallow } from 'zustand/react/shallow';
import {
  MediaSelectorItem,
  MediaSelectorModal,
} from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { useComposerImportFolder } from '@gitroom/frontend/components/composer/use-composer-import-folder';
const Designer = dynamic(
  () => import('@gitroom/frontend/components/media-tools/designer/designer').then(
    (m) => m.Designer
  ),
  { ssr: false }
);
export const Pagination: FC<{
  current: number;
  totalPages: number;
  setPage: (num: number) => void;
}> = (props) => {
  const t = useT();

  const { current, totalPages, setPage } = props;

  const paginationItems = useMemo(() => {
    // Convert to 1-based for algorithm (current is 0-based)
    const c = current + 1;
    const m = totalPages;

    // If total pages <= 10, show all pages
    if (m <= 10) {
      return Array.from({ length: m }, (_, i) => i + 1);
    }

    const delta = 3;
    const left = c - delta;
    const right = c + delta + 1;
    const range: number[] = [];
    const rangeWithDots: (number | '...')[] = [];
    let l: number | undefined;

    // Build the range of pages to show
    for (let i = 1; i <= m; i++) {
      if (i === 1 || i === m || (i >= left && i < right)) {
        range.push(i);
      }
    }

    // Add dots where there are gaps
    for (const i of range) {
      if (l !== undefined) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    }

    // Limit to maximum 10 items by trimming pages near edges if needed
    while (rangeWithDots.length > 10) {
      const currentIndex = rangeWithDots.findIndex((item) => item === c);
      if (currentIndex !== -1 && currentIndex > rangeWithDots.length / 2) {
        // Current is in second half, remove one item from start side
        rangeWithDots.splice(2, 1);
      } else {
        // Current is in first half, remove one item from end side
        rangeWithDots.splice(-3, 1);
      }
    }

    return rangeWithDots;
  }, [current, totalPages]);

  return (
    <ul className="flex flex-row items-center gap-1 justify-center mt-[15px]">
      <li className={clsx(current === 0 && 'opacity-20 pointer-events-none')}>
        <button
          type="button"
          className="cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 ps-2.5 text-gray-400 hover:text-white border-[#1F1F1F] hover:bg-boxHover"
          aria-label={t('go_to_previous_page', 'Go to previous page')}
          onClick={() => setPage(current - 1)}
          disabled={current === 0}
        >
          <ChevronLeftIcon className="lucide lucide-chevron-left h-4 w-4" />
          <span>{t('previous', 'Previous')}</span>
        </button>
      </li>
      {paginationItems.map((item, index) => (
        <li key={item === '...' ? `ellipsis-${index}` : item}>
          {item === '...' ? (
            <span className="inline-flex items-center justify-center h-10 w-10 text-textColor select-none">
              ...
            </span>
          ) : (
            <button
              type="button"
              aria-current={current === item - 1 ? 'page' : undefined}
              onClick={() => setPage(item - 1)}
              disabled={current === item - 1}
              className={clsx(
                'cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border hover:bg-boxHover h-10 w-10 hover:text-white border-newBorder',
                current === item - 1
                  ? 'bg-btnPrimary !text-white'
                  : 'text-textColor hover:text-white'
              )}
            >
              {item}
            </button>
          )}
        </li>
      ))}
      <li
        className={clsx(
          current + 1 === totalPages && 'opacity-20 pointer-events-none'
        )}
      >
        <button
          type="button"
          className="text-textColor hover:text-white group cursor-pointer inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 h-10 px-4 py-2 gap-1 pe-2.5 text-gray-400 border-[#1F1F1F] hover:bg-boxHover"
          aria-label={t('go_to_next_page', 'Go to next page')}
          onClick={() => setPage(current + 1)}
          disabled={current + 1 === totalPages}
        >
          <span>{t('next', 'Next')}</span>
          <ChevronRightIcon className="lucide lucide-chevron-right h-4 w-4" />
        </button>
      </li>
    </ul>
  );
};
type MediaSlot =
  | { kind: 'media'; data: { id: string; path: string; thumbnail?: string } }
  | { kind: 'pending'; key: string; url: string; thumbnail?: string };

export const MultiFileComponent: FC<{
  label: string;
  description: string;
  mediaNotAvailable?: boolean;
  dummy: boolean;
  allData: {
    content: string;
    id?: string;
    image?: Array<{
      id: string;
      path: string;
    }>;
  }[];
  value?: Array<{
    path: string;
    id: string;
  }>;
  text: string;
  name: string;
  error?: any;
  onOpen?: () => void;
  onClose?: () => void;
  toolBar?: React.ReactNode;
  information?: React.ReactNode;
  onChange: (event: {
    target: {
      name: string;
      value?: Array<{
        id: string;
        path: string;
        alt?: string;
        thumbnail?: string;
        thumbnailTimestamp?: number;
      }>;
    };
  }) => void;
}> = (props) => {
  const {
    name,
    error,
    text,
    onChange,
    value,
    dummy,
    toolBar,
    information,
    mediaNotAvailable,
  } = props;
  const user = useUser();
  const permissions = usePermissions();
  const modals = useModals();
  const t = useT();
  const toaster = useToaster();
  const fetch = useFetch();
  const findOrCreateImportFolder = useComposerImportFolder();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Per-tool media availability — optimistic while loading, fail-open on error (a status
  // outage must not silently kill the AI buttons). Gates AI Image / AI Video so we don't
  // offer a generation the org has no provider for (it would 409 server-side).
  const { operationAvailable } = useMediaToolsStatus();
  const [pendingMedia, setPendingMedia] = useState<
    { key: string; url: string; thumbnail?: string }[]
  >([]);

  const mediaDirectory = useMediaDirectory();
  const changeMedia = useCallback(
    (
      m:
        | {
            path: string;
            id: string;
            thumbnail?: string;
          }
        | {
            path: string;
            id: string;
            thumbnail?: string;
          }[]
    ) => {
      const mediaArray = Array.isArray(m) ? m : [m];
      onChange({
        target: {
          name,
          value: [...(value || []), ...mediaArray],
        },
      });
    },
    [name, onChange, value]
  );

  const importStock = useCallback(
    async (item: MediaSelectorItem, folderId: string) => {
      const body: Record<string, any> = {
        url: item.url,
        name:
          item.name ||
          i18next.t('stock_import_fallback', 'stock-import', { lng: i18next.resolvedLanguage || 'en' }),
        folderId,
        type: item.type,
        source: item.stockSource,
        attribution: item.attribution,
      };
      if (item.downloadLocation) {
        body.downloadLocation = item.downloadLocation;
      }
      const res = await fetch('/files/import', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => 'Import failed');
        throw new Error(text);
      }
      return (await res.json()) as { id: string; path: string };
    },
    [fetch]
  );

  const handleConfirm = useCallback(
    async (items: MediaSelectorItem[]) => {
      setPickerOpen(false);
      if (items.length === 0) return;

      const fileItems = items.filter((i) => i.source === 'file');
      const stockItems = items.filter((i) => i.source === 'stock');

      // Add file picks immediately.
      if (fileItems.length > 0) {
        changeMedia(
          fileItems.map((i) => ({
            id: i.fileId!,
            path: i.url,
            thumbnail: i.thumbnail,
          }))
        );
      }

      if (stockItems.length === 0) return;

      // Resolve the dated folder once for the batch.
      let folderId: string;
      try {
        folderId = await findOrCreateImportFolder();
      } catch (err) {
        toaster.show(
          (err as Error).message || t('import_folder_failed', 'Failed to prepare import folder'),
          'warning'
        );
        return;
      }

      // Add pending placeholders.
      const pendingKeys = stockItems.map(
        (i, idx) => `pending-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 8)}`
      );
      setPendingMedia((prev) => [
        ...prev,
        ...stockItems.map((i, idx) => ({
          key: pendingKeys[idx],
          url: i.url,
          thumbnail: i.thumbnail,
        })),
      ]);

      // Import in parallel; per-item failure is isolated.
      await Promise.all(
        stockItems.map(async (item, idx) => {
          const key = pendingKeys[idx];
          try {
            const imported = await importStock(item, folderId);
            setPendingMedia((prev) => prev.filter((p) => p.key !== key));
            changeMedia([{ id: imported.id, path: imported.path, thumbnail: item.thumbnail }]);
          } catch (err) {
            setPendingMedia((prev) => prev.filter((p) => p.key !== key));
            toaster.show(
              t(
                'stock_import_failed_with_message',
                '{{item}} Import failed: {{message}}',
                {
                  item: item.name || t('stock_item', 'Stock item'),
                  message: (err as Error).message,
                }
              ),
              'warning'
            );
          }
        })
      );
    },
    [changeMedia, findOrCreateImportFolder, importStock, t, toaster]
  );

  const clearMedia = useCallback(
    (topIndex: number) => () => {
      onChange({
        target: {
          name,
          value: (value || []).filter((_, index) => index !== topIndex),
        },
      });
    },
    [name, onChange, value]
  );

  const clearPending = useCallback(
    (key: string) => () => {
      setPendingMedia((prev) => prev.filter((p) => p.key !== key));
    },
    []
  );

  return (
    <>
      <div className="b1 flex flex-col gap-[8px] rounded-bl-[8px] select-none w-full">
        <div className="flex gap-[10px] px-[12px]">
          {!!value && (
            <ReactSortable
              list={value}
              setList={(newList) =>
                onChange({ target: { name, value: newList } })
              }
              className="flex gap-[10px] sortable-container"
              animation={200}
              swap={true}
              handle=".dragging"
            >
              {value.map((media, index) => (
                  <div key={media.id} className="cursor-pointer rounded-[5px] w-[40px] h-[40px] border-2 border-newTableBorder relative flex transition-all">
                    <DragHandleIcon className="z-[20] dragging absolute pe-[1px] pb-[3px] -start-[4px] -top-[4px] cursor-move" />

                    <div className="w-full h-full relative group">
                      <button
                        type="button"
                        onClick={async () => {
                          modals.openModal({
                            title: t('media_settings', 'Media Settings'),
                            children: (close) => (
                              <MediaComponentInner
                                media={media as any}
                                onClose={close}
                                onSelect={(selectedValue: any) => {
                                  onChange({
                                    target: {
                                      name,
                                      value: (value || []).map((p) => {
                                        if (p.id === media.id) {
                                          return {
                                            ...p,
                                            ...selectedValue,
                                          };
                                        }
                                        return p;
                                      }),
                                    },
                                  });
                                }}
                              />
                            ),
                          });
                        }}
                        className="absolute top-[50%] left-[50%] -translate-x-[50%] -translate-y-[50%] bg-black/80 rounded-[10px] opacity-0 group-hover:opacity-100 transition-opacity z-[9] p-0 border-0"
                        aria-label={t('media_settings', 'Media Settings')}
                      >
                        <MediaSettingsIcon className="cursor-pointer relative z-[200]" />
                      </button>
                      {hasExtension(media?.path, 'mp4') ? (
                        <VideoFrame url={mediaDirectory.set(media?.path)} />
                      ) : hasExtension(media?.path, 'mp3', 'wav', 'ogg', 'm4a') ? (
                        <div className="flex items-center justify-center w-full h-full">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-textColor/60">
                            <path d="M2 10V14C2 15.1046 2.89543 16 4 16H6L11.2929 20.2929C11.7458 20.7458 12.5 20.4243 12.5 19.8047V4.19534C12.5 3.57571 11.7458 3.25419 11.2929 3.70711L6 8H4C2.89543 8 2 8.89543 2 10Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M15.5355 8.46448C16.4684 9.39734 16.9948 10.6611 17 11.9927C17.0052 13.3243 16.4888 14.5921 15.564 15.5355" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M19.6569 5.17157C21.1494 6.66412 21.9952 8.69168 22 10.8487C22.0048 13.0058 21.1692 15.0372 19.6845 16.5372" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element -- Media URLs may point to arbitrary external storage endpoints configured per org; next/image remotePatterns would need dynamic per-org configuration.
                        <img
                          alt={t('media', 'Media')}
                          className="w-full h-full object-cover rounded-[4px]"
                          src={mediaDirectory.set(media?.path)}
                        />
                      )}
                    </div>

                    <CloseCircleIcon
                      onClick={clearMedia(index)}
                      className="absolute -end-[4px] -top-[4px] z-[20] rounded-full bg-white"
                    />
                  </div>
              ))}
              {pendingMedia.map((pending) => (
                <div
                  key={pending.key}
                  className="rounded-[5px] w-[40px] h-[40px] border-2 border-dashed border-newTableBorder relative flex items-center justify-center"
                  title={t('importing', 'Importing…')}
                >
                  <div className="w-4 h-4 border-2 border-textColor border-t-transparent rounded-full animate-spin" />
                  <CloseCircleIcon
                    onClick={clearPending(pending.key)}
                    className="absolute -end-[4px] -top-[4px] z-[20] rounded-full bg-white cursor-pointer"
                  />
                </div>
              ))}
            </ReactSortable>
          )}
        </div>
        <div className="flex flex-nowrap items-center gap-[8px] px-[12px] border-t border-newColColor w-full b1 text-textColor overflow-x-auto scrollbar-none">
          {!mediaNotAvailable && (
            <div className="flex flex-nowrap shrink-0 py-[10px] b2 items-center gap-[4px]">
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                aria-label={t('insert_media', 'Insert Media')}
                className="cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]"
              >
                <div className="flex gap-[8px] items-center">
                  <div>
                    <InsertMediaIcon />
                  </div>
                  <div className="text-[10px] font-[600] maxMedia:hidden block">
                    {t('insert_media', 'Insert Media')}
                  </div>
                </div>
              </button>
              {!!user?.tier && (
                <ToolbarDropdown
                  label={t('ai_tools', 'AI')}
                  icon={<SparkleIcon />}
                >
                  <MenuItem nested label={t('ai_image', 'AI Image')}>
                    <AiImage
                      value={text}
                      onChange={changeMedia}
                      disabled={!operationAvailable('image')}
                    />
                  </MenuItem>
                  <MenuItem nested label={t('ai_video', 'AI Video')}>
                    <AiVideo
                      value={text}
                      onChange={changeMedia}
                      disabled={!operationAvailable('video')}
                    />
                  </MenuItem>
                  <MenuItem nested label={t('content_tools', 'Content Tools')}>
                    <AiContentTools />
                  </MenuItem>
                  <MenuItem nested label={t('best_time', 'Best Time to Post')}>
                    <AiBestTime />
                  </MenuItem>
                  <MenuItem nested label={t('prompt_library', 'Prompt Library')}>
                    <AiPromptLibraryInsert />
                  </MenuItem>
                  <MenuItem nested label={t('ai_search', 'AI Search')}>
                    <AiSearch />
                  </MenuItem>
                </ToolbarDropdown>
              )}
            </div>
          )}
          {!mediaNotAvailable && (!!toolBar || !!information) && (
            <div className="text-newColColor h-full flex items-center">
              <VerticalDividerIcon />
            </div>
          )}
          {!!toolBar && (
            <div className="flex flex-nowrap shrink-0 py-[10px] b2 items-center gap-[4px]">
              {toolBar}
            </div>
          )}
          {information && (
            <div className="flex-1 justify-end flex py-[10px] b2 items-center gap-[4px]">
              {information}
            </div>
          )}
        </div>
      </div>
      <MediaSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        multiple
        onConfirm={handleConfirm}
        kinds={['image', 'video']}
        // Canonical tab identifiers used by MediaSelectorModal; displayed labels
        // are translated inside the modal via TAB_LABEL_KEYS.
        excludeTabs={['Stock Stickers', 'Stock Icons']}
      />
      <div className="text-[12px] text-dangerText">{error}</div>
    </>
  );
};
export const FileComponent: FC<{
  label: string;
  description: string;
  value?: {
    path: string;
    id: string;
  };
  name: string;
  onChange: (event: {
    target: {
      name: string;
      value?: {
        id: string;
        path: string;
      };
    };
  }) => void;
  type?: 'image' | 'video' | 'audio';
  width?: number;
  height?: number;
}> = (props) => {
  const t = useT();

  const { name, type, label, description, onChange, value, width, height } =
    props;
  const permissions = usePermissions();
  const fetch = useFetch();
  const toaster = useToaster();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const modals = useModals();
  const mediaDirectory = useMediaDirectory();

  const changeMedia = useCallback(
    (m: { path: string; id: string; thumbnail?: string }[]) => {
      onChange({
        target: {
          name,
          value: m[0],
        },
      });
    },
    [name, onChange]
  );

  const showDesignModal = useCallback(() => {
    if (!permissions.hasPermission('media', 'read')) return;
    modals.openModal({
      title: t('media_editor', 'Media Editor'),
      askClose: false,
      closeOnEscape: true,
      fullScreen: true,
      size: 'calc(100% - 80px)',
      height: 'calc(100% - 80px)',
      children: (close) => (
        <Designer
          width={width}
          height={height}
          setMedia={changeMedia}
          closeModal={close}
        />
      ),
    });
  }, [t, permissions, width, height, modals, changeMedia]);

  const handleSelect = useCallback(
    async (item: MediaSelectorItem) => {
      setPickerOpen(false);
      if (item.source === 'file') {
        changeMedia([{ id: item.fileId!, path: item.url }]);
        return;
      }
      setImporting(true);
      try {
        const res = await fetch('/files/import', {
          method: 'POST',
          body: JSON.stringify({
            url: item.url,
            name:
              item.name ||
              i18next.t('stock_import_fallback', 'stock-import', { lng: i18next.resolvedLanguage || 'en' }),
            type: item.type,
            source: item.stockSource,
            attribution: item.attribution,
            ...(item.downloadLocation
              ? { downloadLocation: item.downloadLocation }
              : {}),
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => 'Import failed');
          throw new Error(text);
        }
        const imported = (await res.json()) as { id: string; path: string };
        changeMedia([{ id: imported.id, path: imported.path }]);
      } catch (err) {
        toaster.show(
          t('import_failed_with_message', 'Import failed: {{message}}', {
            message: (err as Error).message,
          }),
          'warning'
        );
      } finally {
        setImporting(false);
      }
    },
    [changeMedia, fetch, t, toaster]
  );

  const clearMedia = useCallback(() => {
    onChange({
      target: {
        name,
        value: undefined,
      },
    });
  }, [name, onChange]);
  return (
    <div className="flex flex-col gap-[8px]">
      <div className="text-[14px]">{label}</div>
      <div className="text-[12px]">{description}</div>
      {!!value && (
        <div className="my-[20px] w-[200px] h-[200px] border-2 border-newTableBorder">
          {type === 'audio' ||
          hasExtension(value.path, 'mp3', 'wav', 'ogg', 'm4a') ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- User-uploaded media preview; captions are not available.
            <audio
              controls
              className="w-full h-full"
              src={mediaDirectory.set(value.path)}
            />
          ) : type === 'video' || hasExtension(value.path, 'mp4') ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption -- User-uploaded media preview; captions are not available.
            <video
              controls
              className="w-full h-full object-cover"
              src={mediaDirectory.set(value.path)}
            />
          ) : (
            <button
              type="button"
              aria-label={t('open_media_preview', 'Open media preview')}
              className="w-full h-full cursor-pointer"
              onClick={() => window.open(mediaDirectory.set(value.path))}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- Media URLs may point to arbitrary external storage endpoints configured per org; next/image remotePatterns would need dynamic per-org configuration. */}
              <img
                alt={t('media_preview', 'Media preview')}
                className="w-full h-full object-cover"
                src={value.path}
              />
            </button>
          )}
        </div>
      )}
      <div className="flex gap-[5px]">
        <Button onClick={() => setPickerOpen(true)} disabled={importing}>
          {importing ? t('importing', 'Importing…') : t('select', 'Select')}
        </Button>
        {permissions.hasPermission('media', 'read') && (
          <Button onClick={showDesignModal} className="!bg-btnPrimary">
            {t('editor', 'Editor')}
          </Button>
        )}
        <Button secondary={true} onClick={clearMedia} disabled={importing}>
          {t('clear', 'Clear')}
        </Button>
      </div>
      <MediaSelectorModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelect}
        kinds={type ? [type === 'audio' ? 'audio' : type === 'video' ? 'video' : 'image'] : undefined}
      />
    </div>
  );
};
