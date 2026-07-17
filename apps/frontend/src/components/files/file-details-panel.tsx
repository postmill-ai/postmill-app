'use client';

import React, { FC, useCallback, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { AudioPlayer } from '@gitroom/frontend/components/media-tools/audio-player';
import { CampaignSelector } from '@gitroom/frontend/components/campaigns/selector/campaign-selector';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import i18next from '@gitroom/react/translation/i18next';
import type { FileItem } from './file-manager';

const formatDate = (dateStr: string) => {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString(i18next.resolvedLanguage || 'en', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
};

const fileSize = (bytes: number, t: ReturnType<typeof useT>) => {
  if (!bytes) return '-';
  if (bytes < 1024) return t('file_size_bytes', '{{size}} B', { size: bytes });
  if (bytes < 1024 * 1024)
    return t('file_size_kb', '{{size}} KB', { size: (bytes / 1024).toFixed(1) });
  return t('file_size_mb', '{{size}} MB', { size: (bytes / (1024 * 1024)).toFixed(1) });
};

export const FileDetailsPanel: FC<{
  file: FileItem;
  onClose: () => void;
  onRefresh: () => void;
  drawerMode?: boolean;
}> = ({ file, onClose, onRefresh, drawerMode }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const mediaDirectory = useMediaDirectory();
  const isVideo = hasExtension(file.path, 'mp4');
  const isAudio = hasExtension(file.path, 'mp3', 'wav', 'ogg', 'm4a');

  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description || '');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState<string[]>(file.tags ? JSON.parse(file.tags) : []);
  const [copied, setCopied] = useState(false);

  const panelRef = useRef<HTMLDivElement>(null);

  const handleSaveName = useCallback(async () => {
    if (name.trim() && name !== file.name) {
      await fetch(`/files/${file.id}/rename`, {
        method: 'PUT',
        body: JSON.stringify({ name: name.trim() }),
      });
      onRefresh();
    }
    setEditingName(false);
  }, [name, file, fetch, onRefresh]);

  const handleSaveDescription = useCallback(async () => {
    await fetch(`/files/${file.id}/description`, {
      method: 'PUT',
      body: JSON.stringify({ description }),
    });
    onRefresh();
    toaster.show(t('description_saved', 'Description saved'), 'success');
  }, [description, file, fetch, onRefresh, toaster, t]);

  const handleAddTag = useCallback(async (tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed || tags.includes(trimmed)) return;
    const newTags = [...tags, trimmed];
    setTags(newTags);
    setTagsInput('');
    await fetch(`/files/${file.id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: newTags }),
    });
    onRefresh();
  }, [tags, file, fetch, onRefresh]);

  const handleRemoveTag = useCallback(async (tag: string) => {
    const newTags = tags.filter(t => t !== tag);
    setTags(newTags);
    await fetch(`/files/${file.id}/tags`, {
      method: 'PUT',
      body: JSON.stringify({ tags: newTags }),
    });
    onRefresh();
  }, [tags, file, fetch, onRefresh]);

  const handleCopyUrl = useCallback(() => {
    navigator.clipboard.writeText(mediaDirectory.set(file.path));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toaster.show(t('url_copied_to_clipboard', 'URL copied to clipboard'), 'success');
  }, [file, mediaDirectory, toaster, t]);

  const handleDelete = useCallback(async () => {
    await fetch(`/files/${file.id}/trash`, { method: 'POST' });
    onRefresh();
    onClose();
    toaster.show(t('file_moved_to_trash', 'File moved to trash'), 'success');
  }, [file, fetch, onRefresh, onClose, toaster, t]);

  const handleDownload = useCallback(() => {
    window.open(mediaDirectory.set(file.path), '_blank');
  }, [file, mediaDirectory]);

  return (
    <div
      ref={panelRef}
      className={clsx(
        'flex flex-col overflow-y-auto scrollbar scrollbar-thumb-newColColor scrollbar-track-transparent',
        drawerMode
          ? 'flex-1 w-full bg-newBgColorInner'
          : 'w-[340px] shrink-0 bg-newBgColorInner rounded-[12px] border border-newBorder'
      )}
    >
      <div className="flex items-center justify-between px-[16px] py-[14px] border-b border-newBorder">
        <div className="text-[14px] font-[600] text-textColor">{t('details', 'Details')}</div>
        <button
          onClick={onClose}
          className="p-[4px] rounded-[4px] text-textColor/60 hover:text-textColor hover:bg-boxHover transition-all"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="p-[16px]">
        <div className="rounded-[8px] overflow-hidden bg-black/20 mb-[16px]">
          {isAudio ? (
            <div className="p-[12px]"><AudioPlayer src={mediaDirectory.set(file.path)} /></div>
          ) : isVideo ? (
            <video src={mediaDirectory.set(file.path)} className="w-full aspect-video object-cover" controls>
              <track kind="captions" src="" label={t('no_captions', 'No captions')} default />
            </video>
          ) : (
            // User-uploaded previews come from dynamic storage URLs; next/image is
            // impractical without a configured loader/known domains, so a native img is used.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={mediaDirectory.set(file.path)} alt="" className="w-full aspect-square object-cover" />
          )}
        </div>

        <div className="space-y-[14px]">
          <div>
            <label htmlFor="file-details-name" className="text-[11px] text-textColor/40 uppercase tracking-wider font-[500]">{t('name', 'Name')}</label>
            {editingName ? (
              <input
                id="file-details-name"
                // Input replaces the clicked name; autofocus keeps keyboard focus on the newly revealed control.
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleSaveName}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') { setName(file.name); setEditingName(false); } }}
                className="w-full mt-[4px] bg-transparent border-b border-[#2B5CD3] text-[13px] text-textColor outline-none"
              />
            ) : (
              <div
                id="file-details-name"
                role="button"
                tabIndex={0}
                aria-label={t('edit_name', 'Edit name')}
                className="mt-[4px] text-[13px] text-textColor cursor-pointer hover:text-btnPrimaryAccent truncate"
                onClick={() => setEditingName(true)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setEditingName(true); } }}
              >
                {name}
              </div>
            )}
          </div>

          <div>
            <label htmlFor="file-details-description" className="text-[11px] text-textColor/40 uppercase tracking-wider font-[500]">{t('description', 'Description')}</label>
            <textarea
              id="file-details-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onBlur={handleSaveDescription}
              placeholder={t('add_a_description_placeholder', 'Add a description...')}
              rows={3}
              className="w-full mt-[4px] bg-newBgColor border border-newColColor rounded-[6px] px-[10px] py-[8px] text-[13px] text-textColor outline-none focus:border-[#2B5CD3] resize-none placeholder:text-textColor/30"
            />
          </div>

          <div>
            <label htmlFor="file-details-tags" className="text-[11px] text-textColor/40 uppercase tracking-wider font-[500]">{t('tags', 'Tags')}</label>
            <div className="flex flex-wrap gap-[6px] mt-[6px]">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-[4px] px-[8px] py-[3px] rounded-[12px] bg-[#2B5CD3]/15 text-[12px] text-btnPrimaryAccent"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-dangerText transition-all"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M7.5 2.5L2.5 7.5M2.5 2.5L7.5 7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}
              <input
                id="file-details-tags"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { handleAddTag(tagsInput); }
                  if (e.key === ',' || e.key === 'Tab') { e.preventDefault(); handleAddTag(tagsInput.replace(',', '')); }
                }}
                placeholder={t('add_tag_placeholder', 'Add tag...')}
                className="flex-1 min-w-[80px] bg-transparent border-b border-newColColor text-[12px] text-textColor outline-none focus:border-[#2B5CD3] placeholder:text-textColor/30"
              />
            </div>
          </div>

          <div className="border-t border-newBorder pt-[14px]">
            <label
              htmlFor="file-details-campaigns"
              className="text-[11px] text-textColor/40 uppercase tracking-wider font-[500] block mb-[6px]"
            >
              {t('campaigns', 'Campaigns')}
            </label>
            <CampaignSelector
              id="file-details-campaigns"
              entityType="file"
              entityId={file.id}
              compact
            />
          </div>

          <div className="border-t border-newBorder pt-[14px] space-y-[8px]">
            <div className="flex justify-between text-[12px]">
              <span className="text-textColor/50">{t('file_size', 'File size')}</span>
              <span className="text-textColor">{fileSize(file.fileSize, t)}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-textColor/50">{t('type', 'Type')}</span>
              <span className="text-textColor">{file.type || t('file_type_image', 'image')}</span>
            </div>
            <div className="flex justify-between text-[12px]">
              <span className="text-textColor/50">{t('created', 'Created')}</span>
              <span className="text-textColor">{formatDate(file.createdAt)}</span>
            </div>
          </div>

          <div className="border-t border-newBorder pt-[14px] space-y-[8px]">
            <button
              onClick={handleCopyUrl}
              className="w-full flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="2" y="4" width="8" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                <path d="M4 4V3C4 1.89543 4.89543 1 6 1H10C11.1046 1 12 1.89543 12 3V9C12 10.1046 11.1046 11 10 11H9" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              {copied ? t('copied', 'Copied!') : t('copy_url', 'Copy URL')}
            </button>
            <button
              onClick={handleDownload}
              className="w-full flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 1V9M7 9L3.5 5.5M7 9L10.5 5.5M2 11V12C2 12.5523 2.44772 13 3 13H11C11.5523 13 12 12.5523 12 12V11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('download', 'Download')}
            </button>
            <button
              onClick={handleDownload}
              className="w-full flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] text-[13px] text-textColor hover:bg-boxHover transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 7H4M4 7l3-3M4 7l3 3" />
                <path d="M2 11h10" />
              </svg>
              {t('open_file', 'Open file')}
            </button>
            <button
              onClick={handleDelete}
              className="w-full flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] text-[13px] text-dangerText hover:bg-boxHover transition-all"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 3.5H12M4.5 3.5V2.5C4.5 2.22386 4.72386 2 5 2H9C9.27614 2 9.5 2.22386 9.5 2.5V3.5M5.5 6.5V10.5M8.5 6.5V10.5M3.16667 3.5L3.83333 11.6667C3.87363 12.1289 4.26222 12.5 4.72727 12.5H9.27273C9.73778 12.5 10.1264 12.1289 10.1667 11.6667L10.8333 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t('delete', 'Delete')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
