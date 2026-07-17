'use client';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/react/form/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { array, boolean, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { Slider } from '@gitroom/react/form/slider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dayjs from 'dayjs';

const PAGE_SIZE = 25;

const details = object().shape({
  title: string().required(),
  content: string(),
  onSlot: boolean().required(),
  syncLast: boolean().required(),
  url: string().url().required(),
  active: boolean().required(),
  addPicture: boolean().required(),
  generateContent: boolean().required(),
  integrations: array().of(object().shape({ id: string().required() })),
});

const getOptions = (t: (key: string, fallback: string) => string) => [
  { label: t('all_integrations', 'All integrations'), value: 'all' },
  { label: t('specific_integrations', 'Specific integrations'), value: 'specific' },
];

const getOptionsChoose = (t: (key: string, fallback: string) => string) => [
  { label: t('yes', 'Yes'), value: true },
  { label: t('no', 'No'), value: false },
];

const getPostImmediately = (t: (key: string, fallback: string) => string) => [
  { label: t('post_on_next_available_slot', 'Post on the next available slot'), value: true },
  { label: t('post_immediately', 'Post Immediately'), value: false },
];

const AddOrEditAutopost: FC<{ data?: any; reload: () => void }> = ({ data, reload }) => {
  const fetch = useFetch();
  const t = useT();
  const options = getOptions(t);
  const optionsChoose = getOptionsChoose(t);
  const postImmediately = getPostImmediately(t);
  const modal = useModals();
  const toast = useToaster();

  const [allIntegrations, setAllIntegrations] = useState(
    (JSON.parse(data?.integrations || '[]')?.length || 0) > 0 ? options[1] : options[0]
  );
  const [valid, setValid] = useState(data?.url || '');
  const [lastUrl, setLastUrl] = useState(data?.lastUrl || '');

  const form = useForm({
    resolver: yupResolver(details),
    values: {
      title: data?.title || '',
      content: data?.content || '',
      onSlot: data?.onSlot ?? false,
      syncLast: data?.syncLast ?? false,
      url: data?.url || '',
      active: data?.hasOwnProperty?.('active') ? data?.active : true,
      addPicture: data?.addPicture ?? false,
      generateContent: data?.hasOwnProperty?.('generateContent') ? data?.generateContent : true,
      integrations: JSON.parse(data?.integrations || '[]') || [],
    },
  });

  const generateContent = useWatch({ name: 'generateContent', control: form.control });
  const content = useWatch({ name: 'content', control: form.control });
  const url = useWatch({ name: 'url', control: form.control });
  const syncLast = useWatch({ name: 'syncLast', control: form.control });
  const integrations = useWatch({ name: 'integrations', control: form.control });

  const integration = useCallback(async () => (await fetch('/integrations/list')).json(), [fetch]);
  const { data: dataList, isLoading } = useSWR('integrations', integration, {
    revalidateOnFocus: false, revalidateOnReconnect: false, revalidateIfStale: false,
    revalidateOnMount: true, refreshWhenHidden: false, refreshWhenOffline: false,
  });

  const changeIntegration = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const findValue = options.find((o) => o.value === e.target.value)!;
    setAllIntegrations(findValue);
    if (findValue.value === 'all') form.setValue('integrations', []);
  }, [options, form]);

  const callBack = useCallback(async (values: any) => {
    await fetch(data?.id ? `/autopost/${data?.id}` : '/autopost', {
      method: data?.id ? 'PUT' : 'POST',
      body: JSON.stringify({
        ...(data?.id ? { id: data.id } : {}),
        ...values,
        ...(!syncLast ? { lastUrl } : { lastUrl: '' }),
      }),
    });
    toast.show(
      data?.id ? t('autopost_updated', 'Autopost updated successfully') : t('autopost_added', 'Autopost added successfully'),
      'success'
    );
    modal.closeAll();
    reload();
  }, [data, lastUrl, syncLast, fetch, modal, reload, toast, t]);

  const sendTest = useCallback(async () => {
    const u = form.getValues('url');
    if (!u || !u.trim()) {
      toast.show(t('enter_rss_url', 'Enter an RSS feed URL first'), 'warning');
      return;
    }
    try {
      const { success, url: newUrl } = await (await fetch(`/autopost/send?url=${encodeURIComponent(u)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
      })).json();
      if (!success) {
        setValid('');
        toast.show(t('rss_feed_invalid', 'Could not use this RSS feed'), 'warning');
        return;
      }
      toast.show(t('rss_valid', 'RSS valid!'), 'success');
      setValid(u);
      setLastUrl(newUrl);
    } catch {
      /** empty **/
    }
  }, [fetch, form, toast, t]);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[4px] pt-0">
          <div>
            <Input label="Title" translationKey="label_title" {...form.register('title')} />
            <Input label="RSS URL" translationKey="label_url" {...form.register('url')} />

            <Select label="Sync from last post?" translationKey="label_should_sync_last_post" {...form.register('syncLast', { setValueAs: (value) => value === 'true' || value === true })}>
              {optionsChoose.map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
            </Select>

            <Select label="When to post?" translationKey="label_when_post" {...form.register('onSlot', { setValueAs: (value) => value === 'true' || value === true })}>
              {postImmediately.map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
            </Select>

            <Select label="Autogenerate content" translationKey="label_autogenerate_content" {...form.register('generateContent', { setValueAs: (value) => value === 'true' || value === true })}>
              {optionsChoose.map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
            </Select>

            {!generateContent && (
              <div className="flex flex-col gap-[6px] mb-[16px]">
                <div className="text-[14px]">{t('post_content', 'Post content')}</div>
                <textarea
                  value={content}
                  onChange={(e) => form.setValue('content', e.target.value)}
                  className="min-h-[120px] p-[12px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none resize-y"
                  placeholder={t('write_your_post_placeholder', 'Write your post...')}
                />
              </div>
            )}

            <Select label="Generate picture?" translationKey="label_generate_picture" {...form.register('addPicture', { setValueAs: (value) => value === 'true' || value === true })}>
              {optionsChoose.map((opt) => <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>)}
            </Select>

            <Select value={allIntegrations.value} name="integrations" label="Integrations" translationKey="label_integrations" disableForm onChange={changeIntegration}>
              {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </Select>

            {allIntegrations.value === 'specific' && dataList && !isLoading && (
              <PickPlatforms
                integrations={dataList.integrations}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip
                isMain
              />
            )}

            <div className="flex gap-[10px] mt-[24px]">
              {(valid === url && (syncLast || !!lastUrl)) && (
                <Button type="submit">{t('save', 'Save')}</Button>
              )}
              <Button type="button" secondary onClick={sendTest}>{t('validate_rss', 'Validate RSS')}</Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};

export const Autopost: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const modal = useModals();
  const toaster = useToaster();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);

  const list = useCallback(async () => (await fetch('/autopost')).json(), [fetch]);
  const { data, mutate, isLoading, error } = useSWR('autopost', list);

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = [...data];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((a: any) => a.title?.toLowerCase().includes(q));
    }
    const start = page * PAGE_SIZE;
    return list.slice(start, start + PAGE_SIZE);
  }, [data, search, page]);

  const totalPages = data ? Math.ceil((data.length || 0) / PAGE_SIZE) : 0;

  const addEdit = useCallback((ruleData?: any) => () => {
    modal.openModal({
      title: ruleData ? t('edit_autopost', 'Edit Autopost') : t('add_autopost_title', 'Add Autopost'),
      withCloseButton: true,
      children: <AddOrEditAutopost data={ruleData} reload={mutate} />,
    });
  }, [modal, mutate, t]);

  const deleteRule = useCallback((rule: any) => async () => {
    if (await deleteDialog(t('are_you_sure_delete_autopost', 'Are you sure you want to delete this autopost rule?'))) {
      await fetch(`/autopost/${rule.id}`, { method: 'DELETE' });
      mutate();
      toaster.show(t('autopost_deleted', 'Autopost rule deleted'), 'success');
    }
  }, [fetch, mutate, toaster, t]);

  const toggleActive = useCallback((rule: any) => async (ac: 'on' | 'off') => {
    await fetch(`/autopost/${rule.id}/active`, {
      method: 'POST',
      body: JSON.stringify({ active: ac === 'on' }),
    });
    mutate();
  }, [fetch, mutate]);

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-[12px] mb-[16px]">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0); }}
            placeholder={t('search_autopost', 'Search by name...')}
            className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          />
        </div>
        <Button onClick={addEdit()}>{t('add_autopost', 'Add Auto Post Rule')}</Button>
      </div>

      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] overflow-x-auto">
        {isLoading && (
          <div className="flex flex-col gap-[8px] py-[16px]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-[12px] animate-pulse" style={{ animationDelay: `${i * 100}ms` }}>
                <div className="h-[16px] bg-newTableHeader rounded-[4px]" style={{ flex: i === 0 ? 2 : 1.5 }} />
                <div className="h-[16px] bg-newTableHeader rounded-[4px]" style={{ flex: 1 }} />
                <div className="h-[16px] bg-newTableHeader rounded-[4px]" style={{ flex: 1 }} />
                <div className="h-[16px] bg-newTableHeader rounded-[4px]" style={{ flex: i < 3 ? 1 : 0.5 }} />
              </div>
            ))}
          </div>
        )}

        {!isLoading && error && !data && (
          <div className="flex flex-col items-center py-[40px] gap-[8px]">
            <div className="text-dangerText text-[14px]">{t('failed_loading_autopost', 'Failed to load auto post rules')}</div>
            <button onClick={() => window.location.reload()} className="text-[12px] text-textColor hover:underline">{t('try_again', 'Try again')}</button>
          </div>
        )}

        {!isLoading && !error && (!data || data.length === 0) && (
          <div className="flex flex-col items-center py-[40px] gap-[16px]">
            <div className="text-textColor/50 text-[14px]">{t('no_autopost_rules', 'No auto post rules yet')}</div>
            <p className="text-[12px] text-newTableText max-w-[400px] text-center">
              {t('autopost_empty_hint', 'Autopost creates posts for you from an RSS feed. Add a feed to get started.')}
            </p>
            <Button onClick={addEdit()}>{t('create_first_autopost', 'Create your first auto post rule')}</Button>
          </div>
        )}

        {!isLoading && data && data.length > 0 && (
          <>
            <div className="min-w-[700px]">
            <div className="grid grid-cols-[2fr,1.5fr,1fr,1fr,1fr] gap-[12px] text-[12px] text-newTableText uppercase font-medium pb-[12px] border-b border-newTableBorder items-center">
              <div>{t('name', 'Name')}</div>
              <div>{t('channels', 'Channels')}</div>
              <div>{t('status', 'Status:')}</div>
              <div>{t('next_run', 'Next Run')}</div>
              <div className="text-end">{t('actions', 'Actions')}</div>
            </div>

            <div className="flex flex-col">
              {filtered.map((r: any) => (
                <div key={r.id} className="grid grid-cols-[2fr,1.5fr,1fr,1fr,1fr] gap-[12px] py-[12px] border-b border-newTableBorder/50 items-center text-[14px]">
                  <div className="truncate">{r.title}</div>
                  <div className="flex gap-[4px]">
                    {r.integrations ? (
                      (() => {
                        let ints: any[];
                        try { ints = JSON.parse(r.integrations); } catch { ints = []; }
                        return ints.length > 0 ? (
                          <>
                            {ints.slice(0, 3).map((i: any) => (
                              <span key={i.id} className="text-[11px] bg-btnPrimary/20 text-btnPrimary px-[6px] py-[2px] rounded-full">
                                {i.name || i.id?.slice(0, 8)}
                              </span>
                            ))}
                            {ints.length > 3 && <span className="text-[11px] text-newTableText">+{ints.length - 3}</span>}
                          </>
                        ) : (
                          <span className="text-[12px] text-newTableText">{t('all_channels', 'All channels')}</span>
                        );
                      })()
                    ) : (
                      <span className="text-[12px] text-newTableText">{t('all_channels', 'All channels')}</span>
                    )}
                  </div>
                  <div>
                    <Slider
                      value={r.active ? 'on' : 'off'}
                      onChange={toggleActive(r)}
                      fill
                    />
                  </div>
                  <div className="text-[12px] text-newTableText">
                    {r.lastUrl ? t('pending', 'Pending') : t('not_run_yet', 'Not run yet')}
                  </div>
                  <div className="flex justify-end gap-[8px]">
                    <button onClick={addEdit(r)} className="text-[12px] text-textColor hover:underline">{t('edit', 'Edit')}</button>
                    <button onClick={deleteRule(r)} className="text-[12px] text-dangerText hover:underline">{t('delete', 'Delete')}</button>
                  </div>
                </div>
              ))}
            </div>

            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-[16px] pt-[12px] border-t border-newTableBorder">
                <div className="text-[12px] text-newTableText">{t('page_of', 'Page {page} of {total}', { page: String(page + 1), total: String(totalPages) })}</div>
                <div className="flex gap-[8px]">
                  <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40">{t('previous', 'Previous')}</button>
                  <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} className="px-[12px] py-[6px] text-[13px] bg-newBgColor border border-newTableBorder rounded-[8px] disabled:opacity-40">{t('next', 'Next')}</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
