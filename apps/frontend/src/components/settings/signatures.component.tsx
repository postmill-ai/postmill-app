'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import clsx from 'clsx';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { MediaSelectorModal } from '@gitroom/frontend/components/media-tools/media-selector-modal';
import { CampaignSelector } from '@gitroom/frontend/components/campaigns/selector/campaign-selector';

const PAGE_SIZE = 25;

interface SignaturePicture {
  id: string;
  path: string;
}

interface SignatureItem {
  id: string;
  name?: string | null;
  content: string;
  autoAdd: boolean;
  channels: string[];
  usageCount: number;
  picture?: SignaturePicture | null;
}

interface Channel {
  id: string;
  name: string;
  picture?: string;
  identifier?: string;
}

// One hook per resource (AGENTS.md): signatures list + the org's channels.
const useSignatures = () => {
  const fetch = useFetch();
  return useSWR<SignatureItem[]>(
    'signatures',
    async () => {
      const res = await fetch('/signatures');
      if (!res.ok) throw createFetchError('failed_to_load_signatures', 'Failed to load signatures');
      return res.json();
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
};

const useChannels = () => {
  const fetch = useFetch();
  return useSWR<Channel[]>(
    'signature-channels',
    async () => {
      const res = await fetch('/integrations/list');
      if (!res.ok) return [];
      return (await res.json()).integrations || [];
    },
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );
};

const ChannelAvatar: FC<{ channel?: Channel; size?: number }> = ({
  channel,
  size = 22,
}) => {
  if (!channel?.picture) {
    return (
      <div
        className="rounded-full bg-newTableHeader shrink-0"
        style={{ width: size, height: size }}
        title={channel?.name}
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- external channel avatar
    <img
      src={channel.picture}
      alt={channel.name}
      title={channel.name}
      className="rounded-full object-cover shrink-0"
      style={{ width: size, height: size }}
    />
  );
};

const AddOrEditSignature: FC<{
  data?: SignatureItem;
  channels: Channel[];
  reload: () => void;
}> = ({ data, channels, reload }) => {
  const fetch = useFetch();
  const toast = useToaster();
  const modal = useModals();
  const t = useT();

  const [name, setName] = useState(data?.name || '');
  const [content, setContent] = useState(data?.content || '');
  const [autoAdd, setAutoAdd] = useState(!!data?.autoAdd);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(data?.channels || [])
  );
  const [picture, setPicture] = useState<SignaturePicture | null>(
    data?.picture || null
  );
  const [showMedia, setShowMedia] = useState(false);
  const [saving, setSaving] = useState(false);

  const toggleChannel = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleLogoSelect = useCallback(
    async (item: { source: string; url: string; fileId?: string; type: string }) => {
      setShowMedia(false);
      if (item.type !== 'image') {
        toast.show(t('logo_must_be_image', 'A logo must be an image'), 'warning');
        return;
      }
      let fileId = item.fileId;
      let path = item.url;
      // Stock picks aren't Files yet — import to get a stable File id/path.
      if (!fileId) {
        const res = await fetch('/files/import', {
          method: 'POST',
          body: JSON.stringify({ url: item.url, name: 'signature-logo', type: 'image' }),
        });
        if (res.ok) {
          const f = await res.json();
          fileId = f.id;
          path = f.path || item.url;
        }
      }
      if (fileId) setPicture({ id: fileId, path });
    },
    [fetch, toast, t]
  );

  const save = useCallback(async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      const body = {
        name: name.trim() || null,
        content,
        autoAdd,
        channels: [...selected],
        pictureId: picture?.id ?? null,
      };
      const res = await fetch(data?.id ? `/signatures/${data.id}` : '/signatures', {
        method: data?.id ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        toast.show(t('signature_save_failed', 'Failed to save signature'), 'warning');
        return;
      }
      toast.show(
        data?.id
          ? t('signature_updated', 'Signature updated successfully')
          : t('signature_added', 'Signature added successfully'),
        'success'
      );
      modal.closeCurrent();
      reload();
    } finally {
      setSaving(false);
    }
  }, [content, name, autoAdd, selected, picture, data, fetch, toast, t, modal, reload]);

  return (
    <div className="relative flex gap-[20px] flex-col flex-1 pt-0">
      <div>
        <label className="text-[12px] text-newTableText mb-[6px] block">
          {t('name_optional', 'Name (optional)')}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('signature_name_placeholder', 'e.g. Brand sign-off')}
          className="w-full bg-newBgColor border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[14px] text-textColor outline-none focus:border-btnPrimary"
        />
      </div>

      <div>
        <label className="text-[12px] text-newTableText mb-[6px] block">
          {t('content', 'Content')}
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[120px] max-h-[240px] w-full p-[12px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor outline-none resize-y scrollbar scrollbar-thumb-tableBorder"
          placeholder={t('write_signature', 'Write your signature...')}
        />
        <div className="text-[11px] text-newTableText text-end mt-[4px]">
          {content.length} {t('characters', 'characters')}
        </div>
      </div>

      {data?.id && (
        <CampaignSelector entityType="signature" entityId={data.id} />
      )}

      {/* Logo / sticker */}
      <div>
        <label className="text-[12px] text-newTableText mb-[6px] block">
          {t('logo_sticker', 'Logo / sticker (optional)')}
        </label>
        {picture ? (
          <div className="flex items-center gap-[12px]">
            {/* eslint-disable-next-line @next/next/no-img-element -- external signature logo */}
            <img
              src={picture.path}
              alt="logo"
              className="w-[48px] h-[48px] rounded-[8px] object-cover border border-newTableBorder"
            />
            <button
              type="button"
              onClick={() => setShowMedia(true)}
              className="text-[12px] text-btnPrimaryAccent hover:underline"
            >
              {t('replace', 'Replace')}
            </button>
            <button
              type="button"
              onClick={() => setPicture(null)}
              className="text-[12px] text-dangerText hover:underline"
            >
              {t('remove', 'Remove')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowMedia(true)}
            className="flex items-center gap-[8px] px-[12px] py-[8px] rounded-[8px] border border-dashed border-newTableBorder text-[13px] text-newTableText hover:bg-boxHover transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="M21 15l-5-5L5 21" />
            </svg>
            {t('add_logo_sticker', 'Add a logo or sticker')}
          </button>
        )}
      </div>

      {/* Channel scope */}
      <div>
        <label className="text-[12px] text-newTableText mb-[6px] block">
          {t('channel_scope', 'Channel scope')}
        </label>
        <div className="text-[11px] text-newTableText mb-[8px]">
          {selected.size === 0
            ? t('applies_all_channels', 'Applies to all channels')
            : t('applies_selected_channels', 'Applies only to the selected channels')}
        </div>
        <div className="flex flex-wrap gap-[8px]">
          {channels.length === 0 && (
            <span className="text-[12px] text-newTableText">
              {t('no_channels_connected', 'No channels connected yet')}
            </span>
          )}
          {channels.map((c) => {
            const on = selected.has(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => toggleChannel(c.id)}
                className={clsx(
                  'flex items-center gap-[6px] px-[8px] py-[5px] rounded-full border text-[12px] transition-colors',
                  on
                    ? 'border-btnPrimary bg-btnPrimary/15 text-textColor'
                    : 'border-newTableBorder text-newTableText hover:bg-boxHover'
                )}
              >
                <ChannelAvatar channel={c} size={18} />
                <span className="truncate max-w-[120px]">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Auto add */}
      <div className="flex items-center gap-[10px] cursor-pointer select-none">
        <button
          type="button"
          role="switch"
          aria-checked={autoAdd}
          onClick={() => setAutoAdd((v) => !v)}
          className={clsx(
            'relative w-[40px] h-[22px] rounded-full transition-colors shrink-0',
            autoAdd ? 'bg-btnPrimary' : 'bg-newTableHeader'
          )}
        >
          <span
            className={clsx(
              'absolute top-[2px] w-[18px] h-[18px] rounded-full bg-white transition-all',
              autoAdd ? 'left-[20px]' : 'left-[2px]'
            )}
          />
        </button>
        <span className="flex flex-col">
          <span className="text-[13px] text-textColor">
            {t('auto_add_signature', 'Auto-add to new posts')}
          </span>
          <span className="text-[11px] text-newTableText">
            {t('auto_add_hint', 'Automatically appended (with its logo) to posts on matching channels')}
          </span>
        </span>
      </div>

      <Button onClick={save} disabled={saving || !content.trim()}>
        {saving ? t('saving', 'Saving...') : t('save', 'Save')}
      </Button>

      <MediaSelectorModal
        open={showMedia}
        onClose={() => setShowMedia(false)}
        onSelect={handleLogoSelect}
      />
    </div>
  );
};

export const SignaturesComponent: FC<{
  appendSignature?: (sig: {
    content: string;
    picture?: SignaturePicture | null;
  }) => void;
}> = ({ appendSignature }) => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();

  const { data, mutate, isLoading, error } = useSignatures();
  const { data: channels } = useChannels();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const channelById = useMemo(() => {
    const map = new Map<string, Channel>();
    for (const c of channels || []) map.set(c.id, c);
    return map;
  }, [channels]);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = [...data];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.content?.toLowerCase().includes(q) ||
          s.name?.toLowerCase().includes(q)
      );
    }
    const start = page * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }, [data, search, page]);

  const totalPages = data ? Math.ceil((data.length || 0) / PAGE_SIZE) : 0;

  const openModal = useCallback(
    (sig?: SignatureItem) => () => {
      modal.openModal({
        title: sig
          ? t('edit_signature', 'Edit Signature')
          : t('add_signature', 'Add Signature'),
        withCloseButton: true,
        children: (
          <AddOrEditSignature data={sig} channels={channels || []} reload={mutate} />
        ),
      });
    },
    [modal, mutate, t, channels]
  );

  const deleteSignature = useCallback(
    (sig: SignatureItem) => async () => {
      if (
        await deleteDialog(
          t('are_you_sure_delete_signature', 'Are you sure you want to delete this signature?')
        )
      ) {
        await fetch(`/signatures/${sig.id}`, { method: 'DELETE' });
        mutate();
        toaster.show(t('signature_deleted', 'Signature deleted successfully'), 'success');
      }
    },
    [fetch, mutate, toaster, t]
  );

  const applySignature = useCallback(
    (sig: SignatureItem) => () => {
      appendSignature?.({ content: sig.content, picture: sig.picture });
      // Best-effort usage tracking; never block the insert on it.
      fetch(`/signatures/${sig.id}/track-usage`, { method: 'POST' })
        .then(() => mutate())
        .catch(() => undefined);
    },
    [appendSignature, fetch, mutate]
  );

  return (
    <div className="flex flex-col">
      <div className="mb-[16px]">
        <h3 className="text-[18px] font-semibold text-textColor">{t('signatures', 'Signatures')}</h3>
        <p className="text-[13px] text-newTableText mt-[4px] max-w-[640px]">
          {t(
            'signatures_description',
            'Create reusable closings or disclaimers that are added automatically to your posts.'
          )}
        </p>
      </div>

      <div className="flex items-center gap-[12px] mb-[16px]">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder={t('search_signatures', 'Search signatures...')}
            className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor outline-none"
          />
        </div>
        <Button onClick={openModal()}>{t('add_signature', 'Add Signature')}</Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-[8px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[72px] bg-newBgColorInner border border-newTableBorder rounded-[12px] animate-pulse"
            />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col items-center gap-[12px]">
          <span className="text-[14px] text-dangerText">
            {t('failed_loading_signatures', 'Failed to load signatures')}
          </span>
          <button
            onClick={() => mutate()}
            className="text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] px-[16px] py-[8px] hover:bg-boxHover transition-colors"
          >
            {t('try_again', 'Try again')}
          </button>
        </div>
      )}

      {!isLoading && !error && (!data || data.length === 0) && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] flex flex-col items-center py-[40px] gap-[16px]">
          <div className="text-textColor/50 text-[14px]">
            {t('no_signatures', 'No signatures yet')}
          </div>
          <p className="text-[12px] text-newTableText max-w-[400px] text-center">
            {t(
              'signatures_empty_hint',
              'Signatures let you add consistent branding, disclaimers, or calls-to-action to the end of your posts.'
            )}
          </p>
          <Button onClick={openModal()}>
            {t('create_first_signature', 'Create your first signature')}
          </Button>
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {filtered.map((sig) => {
            const scoped = (sig.channels || [])
              .map((id) => channelById.get(id))
              .filter(Boolean) as Channel[];
            return (
              <div
                key={sig.id}
                className="flex items-center gap-[14px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[14px]"
              >
                {/* Logo */}
                {sig.picture?.path ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external signature logo
                  <img
                    src={sig.picture.path}
                    alt=""
                    className="w-[44px] h-[44px] rounded-[8px] object-cover border border-newTableBorder shrink-0"
                  />
                ) : (
                  <div className="w-[44px] h-[44px] rounded-[8px] bg-newTableHeader flex items-center justify-center shrink-0 text-newTableText">
                    <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                      <path
                        d="M1.62 13.46C4.99 11.17 6.13 2.73 2.43 2.54c-2.7-.13-.9 4.45 1.62 8.9.39.69 1.04.58 1.3.45.89-.45 1.14-2.59 1.6-3 .46-.4 1.04-.43 1.55.34.63.89 1.16.75 1.55.54.56-.31 1.27-1.48 2.15-.54.58.62.31 1.3 2.72 1.03"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                      />
                    </svg>
                  </div>
                )}

                {/* Name + preview */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[8px]">
                    <span className="text-[14px] text-textColor truncate">
                      {sig.name || sig.content.slice(0, 40) + (sig.content.length > 40 ? '…' : '')}
                    </span>
                    {sig.autoAdd && (
                      <span className="text-[10px] px-[6px] py-[2px] rounded-full bg-btnPrimary/15 text-btnPrimaryAccent shrink-0">
                        {t('auto', 'Auto')}
                      </span>
                    )}
                  </div>
                  {sig.name && (
                    <div className="text-[12px] text-newTableText truncate" title={sig.content}>
                      {sig.content.slice(0, 70)}
                      {sig.content.length > 70 ? '…' : ''}
                    </div>
                  )}
                  <div className="flex items-center gap-[8px] mt-[6px]">
                    {scoped.length === 0 ? (
                      <span className="text-[11px] text-newTableText">
                        {t('all_channels', 'All channels')}
                      </span>
                    ) : (
                      <div className="flex items-center -space-x-[6px]">
                        {scoped.slice(0, 5).map((c) => (
                          <ChannelAvatar key={c.id} channel={c} size={20} />
                        ))}
                        {scoped.length > 5 && (
                          <span className="text-[11px] text-newTableText ps-[10px]">
                            +{scoped.length - 5}
                          </span>
                        )}
                      </div>
                    )}
                    <span className="text-[11px] text-newTableText">
                      · {sig.usageCount || 0} {t('uses', 'uses')}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-[10px] shrink-0">
                  {!!appendSignature && (
                    <button
                      onClick={applySignature(sig)}
                      className="text-[12px] text-btnPrimaryAccent hover:underline"
                    >
                      {t('use', 'Use')}
                    </button>
                  )}
                  <button
                    onClick={openModal(sig)}
                    className="text-[12px] text-textColor hover:underline"
                  >
                    {t('edit', 'Edit')}
                  </button>
                  <button
                    onClick={deleteSignature(sig)}
                    className="text-[12px] text-dangerText hover:underline"
                  >
                    {t('delete', 'Delete')}
                  </button>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-[8px] pt-[12px] border-t border-newTableBorder">
              <div className="text-[12px] text-newTableText">
                {t('page_of', 'Page {page} of {total}', {
                  page: String(page + 1),
                  total: String(totalPages),
                })}
              </div>
              <div className="flex gap-[8px]">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40"
                >
                  {t('previous', 'Previous')}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40"
                >
                  {t('next', 'Next')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
