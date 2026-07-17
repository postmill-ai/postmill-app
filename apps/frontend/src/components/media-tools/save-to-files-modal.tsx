'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface SaveToFilesModalProps {
  url: string;
  name: string;
  source?: string;
  type?: string;
  downloadLocation?: string;
  attribution?: Record<string, unknown>;
  // Bare audio can't be a standalone social post — hide "Save & Post" for it.
  allowPost?: boolean;
  // When provided, the save uploads this locally-produced blob via `/files/upload-simple`
  // (respecting the chosen folder + file name) instead of server-fetching `url` via
  // `/files/import`. Used for icons, whose SVG source `/files/import` intentionally rejects
  // (anti-XSS) — the caller rasterizes to PNG here so folder selection is preserved (6.3g).
  uploadBlob?: () => Promise<Blob>;
}

export const SaveToFilesModal: FC<SaveToFilesModalProps> = ({ url, name, source, type, downloadLocation, attribution, allowPost = true, uploadBlob }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useModals();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [fileName, setFileName] = useState(name);
  const [newFolderName, setNewFolderName] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: folders, mutate: mutateFolders } = useSWR(
    'save-folders',
    async () => {
      const res = await fetch('/files/folders');
      if (!res.ok) return [];
      return res.json();
    }
  );

  const handleCreateFolder = useCallback(async () => {
    if (!newFolderName.trim()) return;
    await fetch('/files/folders', {
      method: 'POST',
      body: JSON.stringify({ name: newFolderName.trim(), parentId: selectedFolderId }),
    });
    setNewFolderName('');
    mutateFolders();
  }, [newFolderName, selectedFolderId, fetch, mutateFolders]);

  const handleSave = useCallback(async (andPost: boolean) => {
    setSaving(true);
    try {
      let res: Response;
      if (uploadBlob) {
        // Local raster (e.g. an icon rasterized from SVG) → multipart upload into the
        // selected folder. `/files/import` would reject the SVG source outright.
        const blob = await uploadBlob();
        const form = new FormData();
        form.append('file', blob, fileName);
        if (selectedFolderId) form.append('folderId', selectedFolderId);
        res = await fetch('/files/upload-simple', { method: 'POST', body: form });
      } else {
        res = await fetch('/files/import', {
          method: 'POST',
          body: JSON.stringify({
            url,
            name: fileName,
            folderId: selectedFolderId,
            source,
            type,
            downloadLocation,
            attribution,
          }),
        });
      }
      if (!res.ok) {
        toaster.show(t('failed_to_save_file', 'Failed to save file'), 'warning');
        return;
      }
      const savedFile = await res.json();
      toaster.show(t('file_saved', 'File saved'), 'success');
      modal.closeAll();

      if (andPost && savedFile) {
        const integrationsRes = await fetch('/integrations');
        if (integrationsRes.ok) {
          const integrations = await integrationsRes.json();
          const { Composer } = await import('@gitroom/frontend/components/composer/composer');
          const dayjs = (await import('dayjs')).default;
          modal.openModal({
            fullScreen: true,
            removeLayout: true,
            children: (
              <Composer
                date={dayjs()}
                integrations={integrations}
                allIntegrations={integrations}
                onlyValues={[{ content: '', id: 'new', image: [{ id: savedFile.id, path: savedFile.path }] }]}
                mutate={() => {}}
                reopenModal={() => {}}
              />
            ),
          });
        }
      }
    } finally {
      setSaving(false);
    }
  }, [url, fileName, selectedFolderId, source, type, downloadLocation, attribution, uploadBlob, fetch, toaster, modal, t]);

  const renderFolderTree = (items: any[], depth: number = 0): React.ReactNode => {
    return (items || []).map((folder: any) => {
      const providerInfo = folder.storageProvider;
      return (
        <div key={folder.id}>
          <button
            type="button"
            aria-pressed={selectedFolderId === folder.id}
            className={`flex items-center w-full text-left gap-[8px] px-[8px] py-[6px] rounded-[6px] text-[13px] transition-all ${
              selectedFolderId === folder.id ? 'bg-[#2B5CD3]/20 text-textColor' : 'text-textColor hover:bg-newColColor/50'
            }`}
            style={{ paddingLeft: `${12 + depth * 16}px` }}
            onClick={() => setSelectedFolderId(folder.id)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M2 4.5C2 3.39543 2.89543 2.5 4 2.5H5.93934C6.46977 2.5 6.97848 2.71071 7.35355 3.08579L8 3.73223C8.18935 3.92156 8.44705 4.02708 8.71573 4.02708H12C13.1046 4.02708 14 4.92251 14 6.02708V11.5C14 12.6046 13.1046 13.5 12 13.5H4C2.89543 13.5 2 12.6046 2 11.5V4.5Z" fill={selectedFolderId === folder.id ? '#2B5CD3' : 'none'} stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="flex-1 truncate">{folder.name}</span>
            {providerInfo && (
              <span className="inline-flex items-center gap-[4px] bg-[#2B5CD3]/15 rounded-[4px] px-[5px] py-[2px] text-[11px] text-newTextColor/70">
                <ProviderIcon identifier={providerInfo.type} name={providerInfo.name} size={14} />
                {providerInfo.type}
              </span>
            )}
            <span className="text-[11px] text-newTextColor/60">{folder._count?.files || 0}</span>
          </button>
          {folder.children?.length ? renderFolderTree(folder.children, depth + 1) : null}
        </div>
      );
    });
  };

  return (
    <div className="flex flex-col gap-[15px] w-[500px] max-w-full">
      <div className="text-[16px] font-[600] text-textColor">{t('save_to_files', 'Save to Files')}</div>

      <div>
        <div className="text-[13px] font-[500] text-textColor mb-[6px]">{t('file_name_label', 'File Name')}</div>
        <input
          type="text"
          value={fileName}
          onChange={e => setFileName(e.target.value)}
          className="w-full h-[40px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[14px] text-textColor outline-none focus:border-[#2B5CD3]"
        />
        {source && (
          <div className="mt-[8px] text-[12px] text-newTextColor/60">
            {source === 'pixabay' && (
              <span>
                {t('powered_by', 'Powered by')}{' '}
                <a
                  href="https://pixabay.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-btnPrimaryAccent hover:underline"
                >
                  Pixabay
                </a>
              </span>
            )}
            {source === 'giphy' && <span>{t('powered_by_giphy', 'Powered by GIPHY')}</span>}
            {source === 'iconify' && (
              <span>
                {(attribution as any)?.set || (attribution as any)?.prefix || 'Iconify'} · {t('license_label', 'License:')}{' '}
                {(attribution as any)?.license || t('unknown', 'Unknown')}
                {/cc-by/i.test(String((attribution as any)?.license || '')) && (
                  <>
                    {' · '}
                    {t('attribution_required', 'Attribution required')}
                  </>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      <div>
        <div className="text-[13px] font-[500] text-textColor mb-[6px]">{t('destination_label', 'Destination')}</div>
        <div className="max-h-[260px] overflow-y-auto border border-studioBorder rounded-[8px] p-[8px] bg-newBgColorInner">
          <button
            type="button"
            aria-pressed={selectedFolderId === null}
            className={`flex items-center w-full text-left gap-[8px] px-[8px] py-[6px] rounded-[6px] text-[13px] transition-all ${
              selectedFolderId === null ? 'bg-[#2B5CD3]/20 text-textColor' : 'text-textColor hover:bg-newColColor/50'
            }`}
            onClick={() => setSelectedFolderId(null)}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M1 6H15" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="flex-1 truncate">{t('all_files_root', 'All Files (root)')}</span>
          </button>
          {folders && renderFolderTree(folders)}
        </div>
      </div>

      <div className="flex gap-[8px] items-center">
        <input
          type="text"
          value={newFolderName}
          onChange={e => setNewFolderName(e.target.value)}
          placeholder={t('new_folder_name_placeholder', 'New folder name...')}
          className="flex-1 h-[36px] px-[12px] rounded-[8px] bg-newBgColorInner border border-newColColor text-[13px] text-textColor outline-none focus:border-[#2B5CD3]"
          onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); }}
        />
        <button
          onClick={handleCreateFolder}
          className="px-[12px] h-[36px] rounded-[8px] bg-btnSimple text-textColor text-[13px] hover:bg-boxHover transition-all"
        >
          {t('create', 'Create')}
        </button>
      </div>

      <div className="flex justify-end gap-[10px] mt-[8px]">
        <button
          onClick={() => modal.closeAll()}
          className="px-[16px] h-[40px] rounded-[8px] border border-newColColor text-textColor text-[13px] hover:bg-boxHover transition-all"
        >
          {t('cancel', 'Cancel')}
        </button>
        <button
          disabled={saving || !fileName.trim()}
          onClick={() => handleSave(false)}
          className="px-[16px] h-[40px] rounded-[8px] bg-[#2B5CD3] text-white text-[13px] font-[500] hover:bg-[#2B5CD3]/80 disabled:opacity-50 transition-all"
        >
          {saving ? t('saving_dots', 'Saving...') : t('save_file', 'Save File')}
        </button>
        {allowPost && (
          <button
            disabled={saving || !fileName.trim()}
            onClick={() => handleSave(true)}
            className="px-[16px] h-[40px] rounded-[8px] bg-green-600 text-white text-[13px] font-[500] hover:bg-green-700 disabled:opacity-50 transition-all"
          >
            {saving ? t('saving_dots', 'Saving...') : t('save_and_post', 'Save & Post')}
          </button>
        )}
      </div>
    </div>
  );
};
