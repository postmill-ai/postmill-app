'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddEditModalProps } from '@gitroom/frontend/components/composer/composer.types';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/composer/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/composer/editor';
import { SelectCurrent } from '@gitroom/frontend/components/composer/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/composer/providers/show.all.providers';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/composer/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { stripHtmlTags } from '@gitroom/helpers/utils/strip.tags';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { capitalize } from 'lodash';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { CopilotChat } from '@copilotkit/react-ui';
import { createPortal } from 'react-dom';
import { useAiActive } from '@gitroom/frontend/components/layout/use-ai-active';
import { DummyCodeComponent } from '@gitroom/frontend/components/composer/dummy.code.component';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import {
  ColorPicker,
  DEFAULT_POST_COLOR,
} from '@gitroom/frontend/components/ui/color-picker';
import {
  SettingsIcon,
  ChevronDownIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useHasScroll } from '@gitroom/frontend/components/ui/is.scroll.hook';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import { BrandPicker } from '@gitroom/frontend/components/launches/brand-picker';
import { ShortlinkPicker } from '@gitroom/frontend/components/composer/shortlink-picker';
import { usePreflight, PreflightResponse } from '@gitroom/frontend/components/composer/content-qa/usePreflight';
import { PreflightPanel } from '@gitroom/frontend/components/composer/content-qa/preflight.panel';
import dayjs from 'dayjs';
import { Button } from '@gitroom/react/form/button';
import SafeImage from '@gitroom/react/helpers/safe.image';
import { useRouter } from 'next/navigation';
import { ComposerLibraryModal } from '@gitroom/frontend/components/composer/composer-library.modal';

const ColorPick: FC<{
  initial: string | null;
  onApply: (color: string | null) => void;
}> = ({ initial, onApply }) => {
  const t = useT();
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div className="flex flex-col gap-[18px] min-w-[280px]">
      <ColorPicker value={value} onChange={setValue} />
      <Button onClick={() => onApply(value)}>{t('apply', 'Apply')}</Button>
    </div>
  );
};

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const aiActive = useAiActive();
  const fetch = useFetch();
  const ref = useRef(null);
  const existingData = useExistingData();
  const [loading, setLoading] = useState(false);
  const toaster = useToaster();
  const modal = useModals();
  const router = useRouter();
  const [showSettings, setShowSettings] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const [pendingScheduleType, setPendingScheduleType] = useState<'draft' | 'now' | 'schedule' | 'update' | null>(null);
  const [preflightData, setPreflightData] = useState<PreflightResponse | null>(null);
  const [mobileTab, setMobileTab] = useState<'compose' | 'preview'>('compose');
  const { data: shortlinkPreferenceData } = useShortlinkPreference();
  const [shortLinkEnabled, setShortLinkEnabled] = useState(false);
  const shortlinkUserToggled = useRef(false);
  const { runPreflight, loading: preflightLoading, reset: resetPreflight } = usePreflight();

  // Per-post heading colour (stored in each post's `settings`). null = default
  // primary blue. A ref keeps the submit callbacks reading the latest value.
  const readInitialColor = (): string | null => {
    const raw = (existingData as any)?.posts?.[0]?.settings;
    let parsed: any = raw;
    if (typeof raw === 'string') {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    return parsed?.color ?? null;
  };
  const [groupColor, setGroupColor] = useState<string | null>(readInitialColor);
  const groupColorRef = useRef<string | null>(groupColor);
  groupColorRef.current = groupColor;
  const colorize = (settings: any) => {
    const next = { ...(settings || {}) };
    if (groupColorRef.current) next.color = groupColorRef.current;
    else delete next.color;
    return next;
  };

  const { addEditSets, mutate, customClose, dummy } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    locked,
    current,
    activateExitButton,
    setHide,
    brandId,
    campaignId,
    global,
    internal,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
      brandId: state.brandId,
      campaignId: state.campaignId,
      global: state.global,
      internal: state.internal,
    }))
  );

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide, setHide]);

  // Default the short-link picker from the org's saved preference (YES = on)
  // until the user explicitly chooses in the composer.
  useEffect(() => {
    if (dummy || addEditSets || shortlinkUserToggled.current) return;
    setShortLinkEnabled(shortlinkPreferenceData?.shortlink === 'YES');
  }, [shortlinkPreferenceData, dummy, addEditSets]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div>{t('settings', 'Settings')}</div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <SafeImage
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="w-[20px] h-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="text-white absolute -end-[5px] -bottom-[5px]"
          />
        </div>
        <div>
          {currentIntegration.name} {t('channel_settings', 'Settings')}
        </div>
      </div>
    );
  }, [current, integrations, t]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const apply = () => {
        const neededIntegrations = integrations.filter(
          (p) => p?.customer?.id === customer
        );
        setSelectedIntegrations(
          neededIntegrations.map((p) => ({
            settings: {},
            selectedIntegrations: p,
          }))
        );
      };

      // Switching customer wipes the current selection and any per-channel work.
      // Only warn when a selected channel actually carries customizations — a
      // per-channel content override (`internal` entry) or non-empty settings —
      // otherwise switch immediately without a prompt.
      const hasCustomizations = selectedIntegrations.some(
        (p) =>
          internal.some((i) => i.integration.id === p.integration.id) ||
          (p.settings && Object.keys(p.settings).length > 0)
      );

      if (!hasCustomizations) {
        apply();
        return;
      }

      deleteDialog(
        t(
          'switch_customer_lose_customizations',
          'Switching customer will clear your selected channels and any per-channel customizations. Continue?'
        ),
        t('yes_switch', 'Yes, switch')
      ).then((confirmed) => {
        if (confirmed) apply();
      });
    },
    [integrations, selectedIntegrations, internal, setSelectedIntegrations, t]
  );

  // "Started composing" = any editor has real text or attached media. Drives both nav guards
  // below so we only warn when there's actual unsaved work — not on an empty composer.
  const hasStartedComposing = useMemo(() => {
    const stripped = (html: string) =>
      stripHtmlTags(html || '')
        .replace(/&nbsp;/g, ' ')
        .trim();
    const hasWork = (v?: { content?: string; media?: any[] }) =>
      stripped(v?.content ?? '').length > 0 || (v?.media?.length ?? 0) > 0;
    // In edit mode the content lives in `internal[].integrationValue`, not
    // `global` (which is one empty value), so inspect both — otherwise the
    // nav guards never arm while editing an existing post.
    return (
      (global || []).some(hasWork) ||
      (internal || []).some((i) => (i?.integrationValue || []).some(hasWork))
    );
  }, [global, internal]);

  // Warn before navigating away (refresh / tab close / back button / new URL) once the user
  // has actually started composing.
  useEffect(() => {
    if (!activateExitButton || dummy || !hasStartedComposing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [activateExitButton, dummy, hasStartedComposing]);

  // Guard soft in-app navigation (clicking a link/nav item) the same way: App Router has no
  // route-change block, so intercept internal-link clicks in the capture phase, confirm via the
  // shared dialog, and only navigate on approval. Only active once the user has started composing.
  useEffect(() => {
    if (!activateExitButton || dummy || !hasStartedComposing) return;
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const anchor = (e.target as HTMLElement | null)?.closest?.(
        'a[href]'
      ) as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // Skip external, new-tab, hash, mailto/tel, download and same-path links.
      if (
        !href ||
        href.startsWith('http') ||
        href.startsWith('#') ||
        href.startsWith('mailto:') ||
        href.startsWith('tel:') ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download') ||
        href === window.location.pathname
      )
        return;
      e.preventDefault();
      e.stopPropagation();
      deleteDialog(
        t(
          'leave_composer_unsaved',
          'You have unsaved changes. Leave and lose them?'
        ),
        t('yes_leave', 'Yes, leave')
      ).then((confirmed) => {
        if (confirmed) router.push(href);
      });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [activateExitButton, dummy, hasStartedComposing, router, t]);

  const deletePost = useCallback(async () => {
    setLoading(true);
    if (
      !(await deleteDialog(
        t(
          'are_you_sure_you_want_to_delete_post',
          'Are you sure you want to delete this post?'
        ),
        t('yes_delete_it', 'Yes, delete it!')
      ))
    ) {
      setLoading(false);
      return;
    }
    const res = await fetch(`/posts/${existingData.group}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      toaster.show(
        (await res.json().catch(() => null))?.message ||
          t('failed_to_delete_post', 'Failed to delete post'),
        'warning'
      );
      setLoading(false);
      return;
    }
    mutate();
    if (customClose) {
      customClose();
      return;
    }
    modal.closeAll();
    return;
  }, [existingData, mutate, modal, customClose, fetch, t, toaster]);

  const saveAsTemplate = useCallback(async () => {
    if (!ref.current?.getAllValues) return;
    const allValues = await ref.current.getAllValues();
    const posts = allValues.map((post: any) => ({
      integration: { id: post.id },
      settings: colorize(post.settings),
      value: post.values.map((value: any) => ({
        content: value.content,
        delay: value.delay || 0,
        image: (value?.media || []).map(
          ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
            id,
            path,
            alt,
            thumbnail,
            thumbnailTimestamp,
          })
        ),
      })),
    }));

    modal.openModal({
      title: t('save_as_template', 'Save as Template'),
      children: (
        <div className="flex flex-col gap-4 p-[16px]">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem(
                'templateName'
              ) as HTMLInputElement;
              const name = input?.value.trim();
              if (!name) return;
              try {
                const res = await fetch('/sets', {
                  method: 'POST',
                  body: JSON.stringify({
                    name,
                    content: JSON.stringify({ posts }),
                  }),
                });
                if (!res.ok) throw new Error('template_save_failed');
                modal.closeAll();
                toaster.show(
                  t('template_saved', 'Template saved successfully'),
                  'success'
                );
              } catch {
                toaster.show(
                  t('template_save_failed', 'Failed to save template'),
                  'warning'
                );
              }
            }}
          >
            <label className="text-[12px] text-newTableText mb-[6px] block">
              {t('template_name', 'Template name')}
            </label>
            <input
              name="templateName"
              type="text"
              placeholder={t(
                'template_name_placeholder',
                'e.g. Product launch boilerplate'
              )}
              className="w-full bg-newBgColor border border-newTableBorder rounded-[8px] px-[12px] py-[8px] text-[14px] text-textColor outline-none focus:border-btnPrimary mb-[16px]"
            />

            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                secondary
                onClick={() => modal.closeAll()}
              >
                {t('cancel', 'Cancel')}
              </Button>
              <Button type="submit">{t('save', 'Save')}</Button>
            </div>
          </form>
        </div>
      ),
    });
  }, [fetch, modal, toaster, t]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update', skipPreflight = false) => async () => {
      // 3.8: claim the loading lock at the very top so a second click during the
      // (network) preflight/getAllValues round-trip can't start a duplicate flow.
      setLoading(true);
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: t('what_do_you_want_to_do', 'What do you want to do?'),
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  {t(
                    'post_already_published_what_to_do',
                    'This post was already published, what do you want to do?'
                  )}
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }
      }

      // 2J: Run preflight check for schedule/now (skip for draft, and when the
      // user already reviewed the panel and clicked Proceed → skipPreflight).
      if ((type === 'schedule' || type === 'now') && !skipPreflight) {
        const allValues = await ref.current.getAllValues();
        const group = existingData.group || makeId(10);
        const posts = allValues.map((post: any) => ({
          integration: { id: post.id },
          group,
          settings: colorize(post.settings),
          value: post.values.map((value: any) => ({
            ...(value.id ? { id: value.id } : {}),
            content: value.content,
            delay: value.delay || 0,
            image: (value?.media || []).map(
              ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                id, path, alt, thumbnail, thumbnailTimestamp,
              })
            ) || [],
          })),
        }));

        const preflightResult = await runPreflight({ type, posts, date: date.utc().format('YYYY-MM-DDTHH:mm:ss') });

        if (
          preflightResult &&
          (preflightResult.blocking.length > 0 ||
            preflightResult.results.some((r) => r.warnings?.length))
        ) {
          setShowPreflight(true);
          setPendingScheduleType(type);
          setPreflightData(preflightResult);
          setLoading(false);
          return;
        }
      }

      // Pull the local values to build the payload, but rely on the server
      // (`/posts/valid`) for the actual validation — checkValidity now lives
      // server-side so it can't be bypassed.
      const allValues = await ref.current.getAllValues();

      const integrationById = (id: string) =>
        selectedIntegrations.find((p) => p.integration.id === id);

      const group = existingData.group || makeId(10);

      const posts = allValues.map((post: any) => ({
        integration: {
          id: post.id,
        },
        group,
        // Per-post `type` mirrors the submit mode. Required for drafts: create.post.dto skips
        // per-provider settings validation only when the POST's own `type === 'draft'`
        // (@ValidateIf on Post.settings) — without it, a draft with X/provider settings is
        // rejected by forbidNonWhitelisted and silently fails to save (data loss).
        ...(type === 'draft' ? { type: 'draft' } : {}),
        settings: colorize(post.settings),
        value: post.values.map((value: any) => ({
          ...(value.id ? { id: value.id } : {}),
          content: value.content,
          delay: value.delay || 0,
          image:
            (value?.media || []).map(
              ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                id,
                path,
                alt,
                thumbnail,
                thumbnailTimestamp,
              })
            ) || [],
        })),
      }));

      if (!dummy) {
        const validRes = await fetch('/posts/valid', {
          method: 'POST',
          body: JSON.stringify({ type, posts }),
        });
        if (!validRes.ok) {
          toaster.show(
            (await validRes.json().catch(() => null))?.message ||
              t('failed_to_validate_post', 'Failed to validate your post'),
            'warning'
          );
          setLoading(false);
          return;
        }
        const checkAllValid = await validRes.json();

        const focus = (id: string, where: 'fix' | 'preview') => {
          integrationById(id)?.ref?.current?.[where]?.();
        };

        const notEnoughChars = checkAllValid.filter((p: any) => p.emptyContent);

        for (const item of notEnoughChars) {
          toaster.show(
            `${capitalize(item.identifier.split('-')[0])} (${item.name}):` +
              ' ' +
              t(
                'post_needs_content_or_image',
                'Your post should have at least one character or one image.'
              ),
            'warning'
          );
          setLoading(false);
          focus(item.id, 'preview');
          return;
        }

        if (type !== 'draft') {
          for (const item of checkAllValid) {
            if (item.valid === false) {
              toaster.show(
                `${capitalize(item.identifier.split('-')[0])} (${item.name}): ${
                  item.settingsError ||
                  t('please_fix_your_settings', 'Please fix your settings')
                }`,
                'warning'
              );
              focus(item.id, 'fix');
              setLoading(false);
              setShowSettings(true);
              return;
            }

            if (item.errors !== true) {
              toaster.show(
                `${capitalize(item.identifier.split('-')[0])} (${item.name}): ${
                  item.errors
                }`,
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              setShowSettings(false);
              return;
            }

            if (item.tooLong) {
              toaster.show(
                t(
                  'post_name_identifier_too_long',
                  '{{name}} ({{identifier}}) post is too long, please fix it',
                  { name: item.name, identifier: item.identifier }
                ),
                'warning'
              );
              focus(item.id, 'preview');
              setLoading(false);
              return;
            }
          }
        }
      }

      // The composer's short-link provider picker decides application; publish
      // still only rewrites foreign URLs, so this flag is intent, not presence.
      const shortLink = !dummy && shortLinkEnabled;

      const data = {
        type,
        ...(repeater ? { inter: repeater } : {}),
        tags,
        shortLink,
        brandId,
        ...(campaignId ? { campaignId } : {}),
        date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
        posts,
      };

      if (dummy) {
        modal.openModal({
          title: '',
          children: <DummyCodeComponent code={data} />,
          classNames: {
            modal: 'w-[100%] bg-transparent text-textColor',
          },
          size: '100%',
          withCloseButton: false,
          closeOnEscape: true,
          closeOnClickOutside: true,
        });

        setLoading(false);
      }

      if (!dummy) {
        if (addEditSets) {
          addEditSets(data);
        } else {
          const url =
            campaignId && type === 'draft'
              ? `/campaigns/${campaignId}/drafts`
              : '/posts';
          const res = await fetch(url, {
            method: 'POST',
            body: JSON.stringify(data),
          });
          if (!res.ok) {
            // 0.11: the shared fetch does not throw on 4xx/5xx — surface the
            // server message, keep the modal open, and clear loading so the
            // user can retry without losing their composed content.
            toaster.show(
              (await res.json().catch(() => null))?.message ||
                t('failed_to_save_post', 'Failed to save your post'),
              'warning'
            );
            setLoading(false);
            return;
          }
        }

        if (!addEditSets) {
          mutate();
          toaster.show(
            !existingData.integration
              ? t('added_successfully', 'Added successfully')
              : t('updated_successfully', 'Updated successfully')
          );
        }
        if (customClose) {
          // 3.8: keep the loading lock until customClose fires so the deferred
          // close can't re-enable the button and reopen a second submit window.
          setTimeout(() => {
            customClose();
          }, 2000);
          return;
        }

        if (!addEditSets) {
          modal.closeAll();
        }
      }
    },
    [
      ref,
      repeater,
      tags,
      date,
      addEditSets,
      dummy,
      shortLinkEnabled,
      brandId,
      campaignId,
      customClose,
      existingData,
      fetch,
      modal,
      mutate,
      runPreflight,
      selectedIntegrations,
      t,
      toaster,
    ]
  );

  return (
    <div className={clsx('w-full h-full flex-1 flex relative', props.padding ?? 'p-[8px] lg:p-[40px]')}>
      <div className="flex flex-1 bg-newBgColorInner rounded-[20px] flex-col overflow-hidden">
        <div className="lg:hidden flex items-center justify-center p-[8px] border-b border-newBorder bg-newBgColor">
          <div className="flex bg-newBgColorInner border border-newBorder rounded-[8px] overflow-hidden">
            <button
              type="button"
              onClick={() => setMobileTab('compose')}
              className={clsx(
                'px-[16px] py-[6px] text-[13px] font-[500] transition-colors',
                mobileTab === 'compose'
                  ? 'bg-btnPrimary text-white'
                  : 'text-textColor hover:bg-boxHover'
              )}
            >
              {t('compose_post', 'Compose Post')}
            </button>
            <button
              type="button"
              onClick={() => setMobileTab('preview')}
              className={clsx(
                'px-[16px] py-[6px] text-[13px] font-[500] transition-colors',
                mobileTab === 'preview'
                  ? 'bg-btnPrimary text-white'
                  : 'text-textColor hover:bg-boxHover'
              )}
            >
              {t('preview', 'Preview')}
            </button>
          </div>
        </div>
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          <div
            className={clsx(
              'flex flex-col flex-1 border-b lg:border-b-0 lg:border-e border-newBorder min-h-0',
              mobileTab === 'preview' ? 'hidden lg:flex' : 'flex'
            )}
          >
            <div className="bg-newBgColor h-[65px] lg:rounded-s-[20px] !rounded-b-[0] hidden lg:flex items-center gap-[12px] px-[20px] text-[20px] font-[600]">
              {t('create_post_title', 'Create Post')}
              <CreationMethodBadge
                creationMethod={existingData?.posts?.[0]?.creationMethod}
                size="sm"
              />
            </div>
            <div className="flex-1 flex flex-col gap-[16px] min-h-0">
              <div
                className={clsx('flex-1 relative', showSettings && 'hidden')}
              >
                <div
                  id="social-content"
                  className="gap-[12px] md:gap-[32px] flex flex-col pe-[8px] pt-[12px] md:pt-[20px] ps-[20px] absolute top-0 left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
                >
                  <div className="flex w-full items-center gap-[8px] flex-wrap">
                    <div className="flex flex-1 min-w-0">
                      <PicksSocialsComponent toolTip={true} />
                    </div>
                    {!dummy && !addEditSets && (
                      <button
                        type="button"
                        onClick={() =>
                          modal.openModal({
                            title: t('library', 'Library'),
                            children: (
                              <ComposerLibraryModal
                                onLoadDraft={
                                  props.onLoadDraft ||
                                  ((group) =>
                                    router.push(`/posts/post/${group}`))
                                }
                                onClose={() => modal.closeAll()}
                              />
                            ),
                          })
                        }
                        className="border border-newTableBorder bg-btnSimple text-textColor rounded-[8px] px-[14px] h-[40px] text-[13px] font-[500] hover:bg-boxHover"
                      >
                        {t('start_from', 'Start from…')}
                      </button>
                    )}
                    {aiActive && (
                      <button
                        type="button"
                        onClick={() => setAssistantOpen(true)}
                        aria-label={t('your_assistant', 'Your Assistant')}
                        data-tooltip-id="tooltip"
                        data-tooltip-content={t('your_assistant', 'Your Assistant')}
                        className="border border-newTableBorder bg-btnSimple text-textColor rounded-[8px] px-[12px] h-[40px] flex items-center gap-[6px] text-[13px] font-[500] hover:bg-boxHover"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-btnPrimaryAccent"
                        >
                          <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
                          <path d="M19 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
                        </svg>
                        <span className="hidden sm:inline">
                          {t('assistant', 'Assistant')}
                        </span>
                      </button>
                    )}
                    <div>
                      {!dummy && (
                        <SelectCustomer
                          onChange={changeCustomer}
                          integrations={integrations}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 gap-[6px] flex-col">
                    <div>{!existingData.integration && <SelectCurrent />}</div>
                    <div className="flex-1 flex min-h-[220px] lg:min-h-0">
                      {!hide && <EditorWrapper totalPosts={1} value="" />}
                    </div>
                    <div
                      id="social-empty"
                      className={clsx(
                        'pb-[16px]'
                        // current !== 'global' && 'hidden'
                      )}
                    />
                  </div>
                </div>
              </div>
              <div
                id="wrapper-settings"
                className={clsx(
                  'pb-[20px] px-[20px] select-none',
                  showSettings && 'flex-1 flex pt-[20px]',
                  current === 'global' && 'hidden'
                )}
              >
                <div className="flex-1 flex flex-col rounded-[12px] gap-[12px] overflow-hidden bg-newSettings">
                  <div
                    onClick={() => setShowSettings(!showSettings)}
                    className={clsx(
                      'bg-[#2B5CD3] rounded-[12px] flex items-center gap-[8px] cursor-pointer p-[12px]',
                      showSettings ? '!rounded-b-none' : ''
                    )}
                  >
                    <div className="flex-1 text-[14px] font-[600] text-white">
                      {currentIntegrationText}
                    </div>
                    <div>
                      <ChevronDownIcon
                        rotated={showSettings}
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div
                    className={clsx(
                      !showSettings ? 'hidden' : 'flex-1',
                      'text-[14px] text-textColor font-[500] relative'
                    )}
                  >
                    <div className="absolute left-0 top-0 w-full h-full flex flex-col overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newBgColorInner scrollbar-track-newColColor">
                      <div
                        id="social-settings"
                        className="flex flex-col gap-[20px] bg-newBgColor"
                      />
                    </div>
                  </div>
                  <style>
                    {`#social-settings [data-id="${current}"] {display: block !important;}`}
                  </style>
                </div>
              </div>
            </div>
          </div>
          <div
            className={clsx(
              'w-full lg:w-[580px] flex flex-col min-h-0',
              mobileTab === 'compose' ? 'hidden lg:flex' : 'flex'
            )}
          >
            <div className="bg-newBgColor h-[65px] lg:rounded-e-[20px] !rounded-b-[0] hidden lg:flex items-center px-[20px] text-[20px] font-[600]">
              <div className="flex-1">{t('post_preview', 'Post Preview')}</div>
            </div>
            <div className="flex-1 relative min-h-0">
              <Scrollable
                scrollClasses="!pe-[20px]"
                className="absolute top-0 p-[20px] pe-[8px] left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
              >
                <ShowAllProviders ref={ref} />
              </Scrollable>
            </div>
          </div>
        </div>
        <div className="select-none h-auto lg:h-[84px] py-[10px] lg:py-[20px] border-t border-newBorder flex flex-col lg:flex-row items-start lg:items-center gap-[8px] lg:gap-0">
          <div className="flex-1 flex ps-[20px] gap-[8px] flex-wrap">
            {!dummy && (
              <TagsComponent
                name="tags"
                label={t('tags', 'Tags')}
                initial={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                }}
              />
            )}

            {!dummy && (
              <RepeatComponent repeat={repeater} onChange={setRepeater} />
            )}
            {!dummy && <BrandPicker />}
            {!dummy && (
              <button
                type="button"
                aria-label={t('post_color', 'Post color')}
                onClick={() =>
                  modal.openModal({
                    title: t('post_color', 'Post color'),
                    withCloseButton: true,
                    children: (
                      <ColorPick
                        initial={groupColor}
                        onApply={(color) => {
                          setGroupColor(color);
                          modal.closeAll();
                        }}
                      />
                    ),
                  })
                }
                className="border rounded-[8px] border-newTextColor/10 h-[36px] lg:h-[44px] px-[12px] lg:px-[16px] flex items-center gap-[8px] text-[13px] lg:text-[15px] font-[600] text-textColor select-none"
              >
                <span
                  className="w-[16px] h-[16px] rounded-full border border-newTableBorder"
                  style={{ backgroundColor: groupColor || DEFAULT_POST_COLOR }}
                />
                {t('color', 'Color')}
              </button>
            )}
            {!dummy && !addEditSets && (
              <ShortlinkPicker
                enabled={shortLinkEnabled}
                onChange={(v) => {
                  shortlinkUserToggled.current = true;
                  setShortLinkEnabled(v);
                }}
              />
            )}
          </div>
          <div className="pe-[20px] flex items-center justify-start lg:justify-end gap-[8px] flex-wrap w-full lg:w-auto">
            {existingData?.integration && (
              <button
                onClick={deletePost}
                className="cursor-pointer flex text-[#FF3F3F] gap-[8px] items-center text-[13px] lg:text-[15px] font-[600]"
              >
                <div>
                  <TrashIcon />
                </div>
                <div>{t('delete_post', 'Delete Post')}</div>
              </button>
            )}
            <DatePicker onChange={setDate} date={date} />
            {!addEditSets && (
              <div className="group cursor-pointer relative">
                <button
                  type="button"
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  className="relative cursor-pointer disabled:cursor-not-allowed px-[12px] lg:px-[20px] h-[36px] lg:h-[44px] bg-btnSimple justify-center items-center flex gap-[6px] rounded-[8px] text-[13px] lg:text-[15px] font-[600]"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                      <div className="animate-spin h-[20px] w-[20px] border-4 border-textColor border-t-transparent rounded-full" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'flex items-center gap-[6px]',
                      loading && 'invisible'
                    )}
                  >
                    {t('save_as', 'Save as')}
                    <DropdownArrowSmallIcon className="group-hover:rotate-180 text-textColor" />
                  </div>
                </button>
                <div className="hidden group-hover:flex flex-col absolute bottom-[100%] left-0 mb-[8px] w-[200px] bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] gap-[6px] z-[300]">
                  <button
                    type="button"
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked
                    }
                    onClick={schedule('draft')}
                    className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 h-[40px] rounded-[6px] bg-btnSimple hover:bg-boxHover flex justify-center items-center text-[14px] font-[600]"
                  >
                    {t('save_as_draft', 'Save as draft')}
                  </button>
                  <button
                    type="button"
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked
                    }
                    onClick={saveAsTemplate}
                    className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 h-[40px] rounded-[6px] bg-btnSimple hover:bg-boxHover flex justify-center items-center text-[14px] font-[600]"
                  >
                    {t('save_as_template', 'Save as Template')}
                  </button>
                </div>
              </div>
            )}
            {addEditSets && (
              <button
                className="text-white text-[15px] font-[600] min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-[8px] bg-[#2B5CD3] ps-[20px] pe-[16px]"
                disabled={
                  selectedIntegrations.length === 0 || loading || locked
                }
                onClick={schedule('draft')}
              >
                Save Set
              </button>
            )}
            {!addEditSets && (
              <div className="group cursor-pointer relative w-full lg:w-auto">
                <button
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  onClick={schedule('schedule')}
                  className="text-white relative w-full lg:min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[38px] lg:h-[44px] rounded-[8px] bg-[#2B5CD3] ps-[14px] lg:ps-[20px] pe-[12px] lg:pe-[16px]"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                      <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'text-[13px] lg:text-[15px] font-[600]',
                      loading && 'invisible'
                    )}
                  >
                    {selectedIntegrations.length === 0
                      ? t('select_a_channel', 'Select a Channel')
                      : dummy
                      ? t('create_output', 'Create output')
                      : !existingData?.integration
                      ? t('add_to_calendar', 'Add to Calendar')
                      : existingData?.posts?.[0]?.state === 'DRAFT'
                      ? t('schedule', 'Schedule')
                      : t('update', 'Update')}
                  </div>
                  {!dummy && (
                    <div className="flex justify-center items-center h-[20px] w-[20px] pt-[4px] arrow-change">
                      <DropdownArrowSmallIcon className="group-hover:rotate-180 text-white" />
                    </div>
                  )}
                </button>

                {!dummy && (
                  <button
                    onClick={schedule('now')}
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked
                    }
                    className="rounded-[8px] z-[300] disabled:cursor-not-allowed disabled:opacity-80 hidden group-hover:flex absolute bottom-[100%] -left-[12px] p-[12px] w-[206px] bg-newBgColorInner"
                  >
                    <div className="text-white rounded-[8px] bg-[#2b5cd3] h-[44px] w-full flex justify-center items-center post-now">
                      {t('post_now', 'Post now')}
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {showPreflight && preflightData && (
        <PreflightPanel
          results={preflightData.results}
          blocking={preflightData.blocking}
          passed={preflightData.passed}
          onClose={() => {
            setShowPreflight(false);
            setPreflightData(null);
            setLoading(false);
          }}
          onProceed={() => {
            setShowPreflight(false);
            setPreflightData(null);
            const pending = pendingScheduleType;
            setPendingScheduleType(null);
            // 3.13: skipPreflight=true so we don't re-run preflight and re-open
            // the panel (which would loop) — proceed straight to submit.
            if (pending) {
              schedule(pending, true)();
            }
          }}
        />
      )}
      {aiActive &&
        assistantOpen &&
        createPortal(
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-[16px]">
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={() => setAssistantOpen(false)}
            />
            <div className="relative w-[600px] max-w-full h-[80vh] max-h-[720px] bg-newBgColorInner border border-newBorder rounded-[16px] shadow-xl flex flex-col overflow-hidden">
              <div className="h-[52px] shrink-0 border-b border-newBorder flex items-center justify-between px-[16px]">
                <div className="flex items-center gap-[8px] text-[16px] font-[600] text-textColor">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-btnPrimaryAccent"
                  >
                    <path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3Z" />
                    <path d="M19 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" />
                  </svg>
                  {t('your_assistant', 'Your Assistant')}
                </div>
                <button
                  type="button"
                  onClick={() => setAssistantOpen(false)}
                  aria-label={t('close', 'Close')}
                  className="w-[32px] h-[32px] rounded-[8px] flex items-center justify-center hover:bg-boxHover text-textColor"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
              <div
                className="flex-1 min-h-0"
                style={
                  {
                    '--copilot-kit-primary-color': 'var(--new-btn-text)',
                    '--copilot-kit-background-color': 'var(--new-bg-color)',
                  } as React.CSSProperties
                }
              >
                <CopilotChat
                  className="h-full"
                  instructions={`
You are an assistant that help the user to schedule their social media posts,
Here are the things you can do:
- Add a new comment / post to the list of posts
- Delete a comment / post from the list of posts
- Add content to the comment / post
- Activate or deactivate the comment / post

Post content can be added using the addPostContentFor{num} function.
After using the addPostFor{num} it will create a new addPostContentFor{num+ 1} function.
`}
                  labels={{
                    title: t('your_assistant', 'Your Assistant'),
                    initial: t(
                      'assistant_initial_message',
                      'Hi! I can help you to refine your social media posts.'
                    ),
                  }}
                />
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

const Scrollable: FC<{
  className: string;
  scrollClasses: string;
  children: ReactNode;
}> = ({ className, scrollClasses, children }) => {
  const ref = useRef(undefined);
  const hasScroll = useHasScroll(ref);
  return (
    <div className={clsx(className, hasScroll && scrollClasses)} ref={ref}>
      {children}
    </div>
  );
};
