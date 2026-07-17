'use client';
import 'reflect-metadata';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import dayjs from 'dayjs';

const PAGE_SIZE = 25;

interface SetMedia {
  id: string;
  path: string;
  thumbnail?: string;
}

// A Set's `content` is the serialized composer payload: { ..., posts: [{
// integration: { id }, value: [{ image: [...] }] }] }. (Older sets may have
// stored the bare posts array — handle both.) Derive the channels, post count
// and media so the list can show a real preview.
const parseSetContent = (
  raw?: string
): { postCount: number; integrationIds: string[]; media: SetMedia[] } => {
  try {
    const parsed = JSON.parse(raw || '{}');
    const posts = Array.isArray(parsed) ? parsed : parsed?.posts || [];
    const integrationIds = posts
      .map((p: any) => p?.integration?.id)
      .filter(Boolean);
    const media: SetMedia[] = posts
      .flatMap((p: any) => (p?.value || []).flatMap((v: any) => v?.image || []))
      .filter((m: any) => m?.path)
      .map((m: any) => ({ id: m.id, path: m.path, thumbnail: m.thumbnail }));
    return { postCount: posts.length, integrationIds, media };
  } catch {
    return { postCount: 0, integrationIds: [], media: [] };
  }
};

const SaveSetModal: FC<{
  postData: any;
  initialValue?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}> = ({ postData, onSave, onCancel, initialValue }) => {
  const [name, setName] = useState(initialValue || '');
  const t = useT();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-[16px]">
      <div>
        <Input
          label={t('label_template_name', 'Template Name')}
          translationKey="label_template_name"
          name="setName"
          value={name}
          disableForm
          onChange={(e) => setName(e.target.value)}
          placeholder={t('enter_a_name_for_this_set', 'Enter a name for this set')}
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" secondary onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

export const Sets: FC = () => {
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, [fetch]);

  const { data: integrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false,
    revalidateOnMount: true, refreshWhenHidden: false, refreshWhenOffline: false,
    fallbackData: [],
  });

  const listSets = useCallback(async () => (await fetch('/sets')).json(), [fetch]);
  const { data, mutate, isLoading, error } = useSWR('sets', listSets, {
    revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false,
    revalidateOnMount: true, refreshWhenHidden: false, refreshWhenOffline: false,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = [...data];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s: any) => s.name?.toLowerCase().includes(q));
    }
    const start = page * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }, [data, search, page]);

  const totalPages = data ? Math.ceil((data.length || 0) / PAGE_SIZE) : 0;

  const channelById = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of integrations || []) map.set(c.id, c);
    return map;
  }, [integrations]);

  const addSet = useCallback((params?: { id?: string; name?: string; content?: string }) => () => {
    modal.openModal({
      id: 'add-edit-modal',
      closeOnClickOutside: false,
      removeLayout: true,
      closeOnEscape: false,
      withCloseButton: false,
      askClose: true,
      fullScreen: true,
      classNames: { modal: 'w-[100%] max-w-[1400px] text-textColor' },
      children: (
        <Composer
          allIntegrations={(integrations || []).map((p: any) => ({ ...p }))}
          {...(params?.id ? { set: JSON.parse(params.content) } : {})}
          addEditSets={(data: any) => {
            modal.openModal({
              title: t('save_as_template', 'Save as Template'),
              children: (
                <SaveSetModal
                  initialValue={params?.name || ''}
                  postData={data}
                  onSave={async (name: string) => {
                    try {
                      await fetch('/sets', {
                        method: 'POST',
                        body: JSON.stringify({
                          ...(params?.id ? { id: params.id } : {}),
                          name,
                          content: JSON.stringify(data),
                        }),
                      });
                      modal.closeAll();
                      mutate();
                      toaster.show(t('template_saved', 'Template saved successfully'), 'success');
                    } catch {
                      toaster.show(t('template_save_failed', 'Failed to save template'), 'warning');
                    }
                  }}
                  onCancel={() => modal.closeAll()}
                />
              ),
            });
          }}
          reopenModal={() => {}}
          mutate={() => {}}
          integrations={integrations || []}
          date={newDayjs()}
        />
      ),
      title: '',
    });
  }, [integrations, fetch, modal, mutate, toaster, t]);

  const deleteSet = useCallback((setData: any) => async () => {
    if (await deleteDialog(t('are_you_sure_delete_set', 'Are you sure you want to delete this set?'))) {
      await fetch(`/sets/${setData.id}`, { method: 'DELETE' });
      mutate();
      toaster.show(t('template_deleted', 'Template deleted successfully'), 'success');
    }
  }, [fetch, mutate, toaster, t]);

  return (
    <div className="flex flex-col">
      <div className="mb-[16px]">
        <h3 className="text-[18px] font-semibold text-textColor">{t('post_templates', 'Post Templates')}</h3>
        <p className="text-[13px] text-newTableText mt-[4px]">
          {t('post_templates_description', 'Save a reusable bundle of channels, text, and media for posts you create often.')}
        </p>
      </div>

      <div className="flex items-center gap-[12px] mb-[16px]">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t('search_templates', 'Search by name...')}
            className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          />
        </div>
        <Button onClick={addSet()}>{t('add_template', 'Add Template')}</Button>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-[8px]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-[84px] bg-newBgColorInner border border-newTableBorder rounded-[12px] animate-pulse"
            />
          ))}
        </div>
      )}

      {!isLoading && error && !data && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col items-center gap-[12px]">
          <span className="text-[14px] text-dangerText">{t('failed_loading_templates', 'Failed to load templates')}</span>
          <button onClick={() => mutate()} className="text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] px-[16px] py-[8px] hover:bg-boxHover transition-colors">{t('try_again', 'Try again')}</button>
        </div>
      )}

      {!isLoading && !error && (!data || data.length === 0) && (
        <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] flex flex-col items-center py-[40px] gap-[16px]">
          <div className="text-textColor/50 text-[14px]">{t('no_templates', 'No post templates created yet')}</div>
          <p className="text-[12px] text-newTableText max-w-[400px] text-center">
            {t('templates_empty_hint', 'Post templates let you save groups of channels, content and media together so you can quickly reuse them when creating new posts.')}
          </p>
          <Button onClick={addSet()}>{t('create_first_template', 'Create your first template')}</Button>
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          {filtered.map((s: any) => {
            const { postCount, integrationIds, media } = parseSetContent(s.content);
            const channels = integrationIds
              .map((id) => channelById.get(id))
              .filter(Boolean);
            return (
              <div
                key={s.id}
                className="flex items-center gap-[14px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[14px]"
              >
                {/* Media preview stack */}
                {media.length > 0 ? (
                  <div className="flex items-center -space-x-[10px] shrink-0">
                    {media.slice(0, 3).map((m) => (
                      // eslint-disable-next-line @next/next/no-img-element -- external media thumbnail
                      <img
                        key={m.id}
                        src={m.thumbnail || m.path}
                        alt=""
                        className="w-[44px] h-[44px] rounded-[8px] object-cover border border-newTableBorder bg-newTableHeader"
                      />
                    ))}
                    {media.length > 3 && (
                      <div className="w-[44px] h-[44px] rounded-[8px] border border-newTableBorder bg-newTableHeader flex items-center justify-center text-[12px] text-newTableText ps-[10px]">
                        +{media.length - 3}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-[44px] h-[44px] rounded-[8px] bg-newTableHeader flex items-center justify-center shrink-0 text-newTableText">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1" />
                      <rect x="14" y="3" width="7" height="7" rx="1" />
                      <rect x="3" y="14" width="7" height="7" rx="1" />
                      <rect x="14" y="14" width="7" height="7" rx="1" />
                    </svg>
                  </div>
                )}

                {/* Name + meta */}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-textColor truncate">{s.name}</div>
                  <div className="flex items-center gap-[10px] mt-[6px]">
                    {channels.length > 0 ? (
                      <div className="flex items-center -space-x-[6px]">
                        {channels.slice(0, 6).map((c: any) => (
                          c?.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element -- external channel avatar
                            <img
                              key={c.id}
                              src={c.picture}
                              alt={c.name}
                              title={c.name}
                              className="w-[20px] h-[20px] rounded-full border border-newTableBorder object-cover"
                            />
                          ) : (
                            <div key={c?.id} className="w-[20px] h-[20px] rounded-full border border-newTableBorder bg-newTableHeader" title={c?.name} />
                          )
                        ))}
                        {channels.length > 6 && (
                          <span className="text-[11px] text-newTableText ps-[10px]">+{channels.length - 6}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-[11px] text-newTableText">{t('no_channels', 'No channels yet')}</span>
                    )}
                    <span className="text-[11px] text-newTableText">
                      · {postCount} {postCount === 1 ? t('post', 'Post') : t('posts_lower', 'posts')}
                    </span>
                    <span className="text-[11px] text-newTableText">
                      · {dayjs(s.createdAt).format(t('set_date_format', 'MMM D, YYYY'))}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-[10px] shrink-0">
                  <button onClick={addSet(s)} className="text-[12px] text-textColor hover:underline">{t('edit', 'Edit')}</button>
                  <button onClick={deleteSet(s)} className="text-[12px] text-dangerText hover:underline">{t('delete', 'Delete')}</button>
                </div>
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-[8px] pt-[12px] border-t border-newTableBorder">
              <div className="text-[12px] text-newTableText">{t('page_of', 'Page {page} of {total}', { page: String(page + 1), total: String(totalPages) })}</div>
              <div className="flex gap-[8px]">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40">{t('previous', 'Previous')}</button>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40">{t('next', 'Next')}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
