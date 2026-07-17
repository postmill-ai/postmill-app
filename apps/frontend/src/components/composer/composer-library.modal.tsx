'use client';

import React, {
  FC,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { useShallow } from 'zustand/react/shallow';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Button } from '@gitroom/react/form/button';
import { Integrations } from '@gitroom/frontend/components/launches/calendar.context';
import dayjs from 'dayjs';
import clsx from 'clsx';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { expandPostsList } from '@gitroom/helpers/utils/posts.list.minify';

type Tab = 'drafts' | 'templates' | 'signatures';

interface DraftItem {
  id: string;
  group: string;
  content: string;
  state: string;
  publishDate: string;
  integration?: {
    id: string;
    name: string;
    picture?: string;
    providerIdentifier?: string;
  };
}

interface TemplateItem {
  id: string;
  name: string;
  content: string;
  createdAt: string;
}

interface SignatureItem {
  id: string;
  name?: string | null;
  content: string;
  picture?: { id: string; path: string } | null;
  autoAdd: boolean;
  channels: string[];
}

interface ComposerLibraryModalProps {
  onLoadDraft: (group: string) => void;
  onClose: () => void;
}

const TAB_ORDER: Tab[] = ['drafts', 'templates', 'signatures'];

const parseTemplateContent = (raw?: string) => {
  try {
    const parsed = JSON.parse(raw || '{}');
    const posts = Array.isArray(parsed) ? parsed : parsed?.posts || [];
    const integrationIds = posts
      .map((p: any) => p?.integration?.id)
      .filter(Boolean);
    const mediaCount = posts.reduce(
      (acc: number, p: any) =>
        acc +
        (p?.value || []).reduce(
          (macc: number, v: any) => macc + (v?.image?.length || 0),
          0
        ),
      0
    );
    return { postCount: posts.length, integrationIds, mediaCount };
  } catch {
    return { postCount: 0, integrationIds: [], mediaCount: 0 };
  }
};

const stripHtml = (html: string) =>
  (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

export const ComposerLibraryModal: FC<ComposerLibraryModalProps> = ({
  onLoadDraft,
  onClose,
}) => {
  const t = useT();
  const fetch = useFetch();
  const [tab, setTab] = useState<Tab>('drafts');
  const [search, setSearch] = useState('');

  const {
    integrations,
    reset,
    setGlobalValue,
    setGlobalValueText,
    addGlobalValueMedia,
    addOrRemoveSelectedIntegration,
    setCurrent,
  } = useLaunchStore(
    useShallow((state) => ({
      integrations: state.integrations,
      reset: state.reset,
      setGlobalValue: state.setGlobalValue,
      setGlobalValueText: state.setGlobalValueText,
      addGlobalValueMedia: state.addGlobalValueMedia,
      addOrRemoveSelectedIntegration: state.addOrRemoveSelectedIntegration,
      setCurrent: state.setCurrent,
    }))
  );

  const loadDrafts = useCallback(async () => {
    const res = await fetch('/posts/list?page=0&limit=100&state=draft');
    if (!res.ok) throw new Error('failed_to_load_drafts');
    // The list endpoint minifies keys (group→g, content→c, …); expand first.
    const json = expandPostsList(await res.json());
    const posts = (json.posts || []) as DraftItem[];
    // Multi-channel drafts are one row per integration sharing a `group`;
    // collapse to one card per group (keeps keys unique + avoids duplicates).
    const byGroup = new Map<string, DraftItem>();
    for (const p of posts) {
      const key = p.group || p.id;
      if (key && !byGroup.has(key)) byGroup.set(key, p);
    }
    return Array.from(byGroup.values());
  }, [fetch]);

  const loadTemplates = useCallback(async () => {
    const res = await fetch('/sets');
    if (!res.ok) throw new Error('failed_to_load_templates');
    return (await res.json()) as TemplateItem[];
  }, [fetch]);

  const loadSignatures = useCallback(async () => {
    const res = await fetch('/signatures');
    if (!res.ok) throw new Error('failed_to_load_signatures');
    return (await res.json()) as SignatureItem[];
  }, [fetch]);

  const {
    data: drafts,
    isLoading: draftsLoading,
    error: draftsError,
    mutate: mutateDrafts,
  } = useSWR('composer-library-drafts', loadDrafts, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const {
    data: templates,
    isLoading: templatesLoading,
    error: templatesError,
  } = useSWR('composer-library-templates', loadTemplates, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  const {
    data: signatures,
    isLoading: signaturesLoading,
    error: signaturesError,
  } = useSWR('composer-library-signatures', loadSignatures, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });

  useEffect(() => {
    // Refresh drafts when the modal opens in case a draft was just saved.
    mutateDrafts();
  }, [mutateDrafts]);

  const filteredDrafts = useMemo(() => {
    if (!drafts || !search.trim()) return drafts || [];
    const q = search.toLowerCase();
    return drafts.filter(
      (d) =>
        stripHtml(d.content).toLowerCase().includes(q) ||
        d.integration?.name?.toLowerCase().includes(q)
    );
  }, [drafts, search]);

  const filteredTemplates = useMemo(() => {
    if (!templates || !search.trim()) return templates || [];
    const q = search.toLowerCase();
    return templates.filter((s) => s.name?.toLowerCase().includes(q));
  }, [templates, search]);

  const filteredSignatures = useMemo(() => {
    if (!signatures || !search.trim()) return signatures || [];
    const q = search.toLowerCase();
    return signatures.filter(
      (s) =>
        (s.name || '').toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q)
    );
  }, [signatures, search]);

  const applyTemplate = useCallback(
    (template: TemplateItem) => {
      const parsed = JSON.parse(template.content || '{}');
      const posts = Array.isArray(parsed) ? parsed : parsed?.posts || [];

      reset();
      for (const post of posts) {
        const integration = integrations.find(
          (i) => i.id === post?.integration?.id
        );
        if (integration) {
          addOrRemoveSelectedIntegration(integration, post.settings || {});
        }
      }

      const values = (posts[0]?.value || []).map((v: any) => ({
        id: makeId(10),
        content:
          (v.content || '').indexOf('<p>') > -1
            ? v.content
            : (v.content || '')
                .split('\n')
                .map((line: string) => `<p>${line}</p>`)
                .join(''),
        delay: v.delay || 0,
        media: (v.image || v.media || []).map((m: any) => ({
          id: m.id,
          path: m.path,
          thumbnail: m.thumbnail,
        })),
      }));

      setGlobalValue(
        values.length
          ? values
          : [{ content: '', id: makeId(10), delay: 0, media: [] }]
      );
      setCurrent('global');
      onClose();
    },
    [
      integrations,
      reset,
      addOrRemoveSelectedIntegration,
      setGlobalValue,
      setCurrent,
      onClose,
    ]
  );

  const insertSignature = useCallback(
    (sig: SignatureItem) => {
      if (!useLaunchStore.getState().global.length) {
        setGlobalValue([{ content: '', id: makeId(10), delay: 0, media: [] }]);
      }
      const current = useLaunchStore.getState().global[0];
      const prefix = current?.content ? '\n\n' : '';
      const nextContent =
        (current?.content || '') +
        prefix +
        (sig.content || '')
          .split('\n')
          .map((line: string) => `<p>${line}</p>`)
          .join('');
      setGlobalValueText(0, nextContent);
      if (sig.picture?.id) {
        addGlobalValueMedia(0, [
          { id: sig.picture.id, path: sig.picture.path },
        ]);
      }
      fetch(`/signatures/${sig.id}/track-usage`, { method: 'POST' }).catch(
        () => undefined
      );
      onClose();
    },
    [setGlobalValue, setGlobalValueText, addGlobalValueMedia, fetch, onClose]
  );

  const loadDraft = useCallback(
    (draft: DraftItem) => {
      onLoadDraft(draft.group);
      onClose();
    },
    [onLoadDraft, onClose]
  );

  const isLoading =
    (tab === 'drafts' && draftsLoading) ||
    (tab === 'templates' && templatesLoading) ||
    (tab === 'signatures' && signaturesLoading);

  const error =
    (tab === 'drafts' && draftsError) ||
    (tab === 'templates' && templatesError) ||
    (tab === 'signatures' && signaturesError);

  const items =
    tab === 'drafts'
      ? filteredDrafts
      : tab === 'templates'
      ? filteredTemplates
      : filteredSignatures;

  const integrationById = useMemo(() => {
    const map = new Map<string, Integrations>();
    for (const i of integrations) map.set(i.id, i);
    return map;
  }, [integrations]);

  return (
    <div className="flex flex-col w-full max-w-[560px] max-h-[80vh]">
      <div className="flex items-center gap-[8px] border-b border-newTableBorder mb-[16px]">
        {TAB_ORDER.map((tKey) => (
          <button
            key={tKey}
            type="button"
            onClick={() => setTab(tKey)}
            className={clsx(
              'px-[12px] py-[10px] text-[13px] font-[500] transition-colors relative',
              tab === tKey
                ? 'text-textColor'
                : 'text-newTableText hover:text-textColor'
            )}
          >
            {tKey === 'drafts' && t('drafts', 'Drafts')}
            {tKey === 'templates' && t('post_templates', 'Post Templates')}
            {tKey === 'signatures' && t('signatures', 'Signatures')}
            {tab === tKey && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-btnPrimary rounded-t-[2px]" />
            )}
          </button>
        ))}
      </div>

      <div className="mb-[12px]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('search_library', 'Search...')}
          className="w-full px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] text-textColor outline-none focus:border-btnPrimary"
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-[200px] max-h-[50vh] scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner">
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
          <div className="flex flex-col items-center justify-center h-[160px] gap-[12px] text-center">
            <span className="text-[14px] text-dangerText">
              {t('library_load_failed', 'Failed to load library items')}
            </span>
            <Button onClick={() => window.location.reload()} secondary>
              {t('try_again', 'Try again')}
            </Button>
          </div>
        )}

        {!isLoading && !error && items.length === 0 && (
          <div className="flex flex-col items-center justify-center h-[160px] text-center gap-[8px]">
            <span className="text-[14px] text-newTableText">
              {tab === 'drafts' && t('no_drafts', 'No drafts yet')}
              {tab === 'templates' &&
                t('no_templates', 'No post templates created yet')}
              {tab === 'signatures' && t('no_signatures', 'No signatures yet')}
            </span>
            <span className="text-[12px] text-newTableText max-w-[320px]">
              {tab === 'drafts' &&
                t(
                  'no_drafts_hint',
                  'Save posts as drafts to resume them here.'
                )}
              {tab === 'templates' &&
                t(
                  'no_templates_hint',
                  'Save reusable channel + content bundles as post templates.'
                )}
              {tab === 'signatures' &&
                t(
                  'no_signatures_hint',
                  'Create signatures in Settings → Post Templates & Signatures.'
                )}
            </span>
          </div>
        )}

        {!isLoading && !error && items.length > 0 && (
          <div className="flex flex-col gap-[8px] pr-[4px]">
            {tab === 'drafts' &&
              (items as DraftItem[]).map((draft) => (
                <div
                  key={draft.group || draft.id}
                  className="flex items-center gap-[12px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[12px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-textColor truncate">
                      {stripHtml(draft.content) || t('empty_draft', 'Empty draft')}
                    </div>
                    <div className="flex items-center gap-[8px] mt-[4px]">
                      {draft.integration?.picture ? (
                        <SafeImage
                          src={draft.integration.picture}
                          alt={draft.integration.name}
                          className="w-[16px] h-[16px] rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-[16px] h-[16px] rounded-full bg-newTableHeader" />
                      )}
                      <span className="text-[12px] text-newTableText">
                        {draft.integration?.name || t('no_channel', 'No channel')}
                      </span>
                      <span className="text-[12px] text-newTableText">
                        · {dayjs(draft.publishDate).format('MMM D, YYYY')}
                      </span>
                    </div>
                  </div>
                  <Button onClick={() => loadDraft(draft)}>
                    {t('load', 'Load')}
                  </Button>
                </div>
              ))}

            {tab === 'templates' &&
              (items as TemplateItem[]).map((template) => {
                const { postCount, integrationIds, mediaCount } =
                  parseTemplateContent(template.content);
                const channels = integrationIds
                  .map((id: string) => integrationById.get(id))
                  .filter(Boolean) as Integrations[];
                return (
                  <div
                    key={template.id}
                    className="flex items-center gap-[12px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[12px]"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] text-textColor truncate">
                        {template.name}
                      </div>
                      <div className="flex items-center gap-[8px] mt-[4px]">
                        {channels.length > 0 ? (
                          <div className="flex items-center -space-x-[4px]">
                            {channels.slice(0, 4).map((c: Integrations, i: number) =>
                              c?.picture ? (
                                <SafeImage
                                  key={c.id || i}
                                  src={c.picture}
                                  alt={c.name}
                                  className="w-[16px] h-[16px] rounded-full border border-newTableBorder object-cover"
                                />
                              ) : (
                                <div
                                  key={c?.id || i}
                                  className="w-[16px] h-[16px] rounded-full border border-newTableBorder bg-newTableHeader"
                                />
                              )
                            )}
                            {channels.length > 4 && (
                              <span className="text-[11px] text-newTableText ps-[8px]">
                                +{channels.length - 4}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-[12px] text-newTableText">
                            {t('no_channels', 'No channels yet')}
                          </span>
                        )}
                        <span className="text-[12px] text-newTableText">
                          · {postCount} {postCount === 1 ? t('post', 'Post') : t('posts_lower', 'posts')}
                        </span>
                        {mediaCount > 0 && (
                          <span className="text-[12px] text-newTableText">
                            · {mediaCount}{' '}
                            {mediaCount === 1
                              ? t('image', 'Image')
                              : t('images', 'Images')}
                          </span>
                        )}
                      </div>
                    </div>
                    <Button onClick={() => applyTemplate(template)}>
                      {t('apply', 'Apply')}
                    </Button>
                  </div>
                );
              })}

            {tab === 'signatures' &&
              (items as SignatureItem[]).map((sig) => (
                <div
                  key={sig.id}
                  className="flex items-center gap-[12px] bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[12px]"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[14px] text-textColor truncate">
                      {sig.name || t('untitled_signature', 'Untitled signature')}
                    </div>
                    <div className="text-[12px] text-newTableText truncate mt-[4px]">
                      {stripHtml(sig.content)}
                    </div>
                  </div>
                  {sig.picture?.path && (
                    <SafeImage
                      src={sig.picture.path}
                      alt=""
                      className="w-[36px] h-[36px] rounded-[8px] object-cover border border-newTableBorder"
                    />
                  )}
                  <Button onClick={() => insertSignature(sig)}>
                    {t('insert', 'Insert')}
                  </Button>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="flex justify-end pt-[16px] border-t border-newTableBorder mt-[12px]">
        <Button onClick={onClose} secondary>
          {t('close', 'Close')}
        </Button>
      </div>
    </div>
  );
};
