'use client';

import React, { FC, useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useCalendar } from './context';
import type { Integrations } from './context';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Fragment } from 'react';
import { Post } from '@prisma/client';
import { Composer } from '@gitroom/frontend/components/composer/composer';
import { Button } from '@gitroom/react/form/button';
import { ColorPicker } from '@gitroom/frontend/components/ui/color-picker';
import { PostAnalyticsDrawer } from '@gitroom/frontend/components/analytics-v2/post-analytics.drawer';
import { MissingReleaseModal } from '@gitroom/frontend/components/launches/missing-release.modal';
import { PostDetailModal } from '@gitroom/frontend/components/launches/post-detail/post.detail.modal';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import copy from 'copy-to-clipboard';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';

export const convertTimeFormatBasedOnLocality = (time: number) => {
  if (isUSCitizen()) {
    return `${time === 12 ? 12 : time % 12}:00 ${time >= 12 ? 'PM' : 'AM'}`;
  } else {
    return `${time}:00`;
  }
};

export const hours = Array.from({ length: 24 }, (_, i) => i);

export const formatCompactNumber = (n: number) => {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
};

export const ViewsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M30.9137 15.595C30.87 15.4963 29.8112 13.1475 27.4575 10.7937C24.3212 7.6575 20.36 6 16 6C11.64 6 7.67874 7.6575 4.54249 10.7937C2.18874 13.1475 1.12499 15.5 1.08624 15.595C1.02938 15.7229 1 15.8613 1 16.0012C1 16.1412 1.02938 16.2796 1.08624 16.4075C1.12999 16.5062 2.18874 18.8538 4.54249 21.2075C7.67874 24.3425 11.64 26 16 26C20.36 26 24.3212 24.3425 27.4575 21.2075C29.8112 18.8538 30.87 16.5062 30.9137 16.4075C30.9706 16.2796 31 16.1412 31 16.0012C31 15.8613 30.9706 15.7229 30.9137 15.595ZM16 24C12.1525 24 8.79124 22.6012 6.00874 19.8438C4.86704 18.7084 3.89572 17.4137 3.12499 16C3.89551 14.5862 4.86686 13.2915 6.00874 12.1562C8.79124 9.39875 12.1525 8 16 8C19.8475 8 23.2087 9.39875 25.9912 12.1562C27.1352 13.2912 28.1086 14.5859 28.8812 16C27.98 17.6825 24.0537 24 16 24ZM16 10C14.8133 10 13.6533 10.3519 12.6666 11.0112C11.6799 11.6705 10.9108 12.6075 10.4567 13.7039C10.0026 14.8003 9.88377 16.0067 10.1153 17.1705C10.3468 18.3344 10.9182 19.4035 11.7573 20.2426C12.5965 21.0818 13.6656 21.6532 14.8294 21.8847C15.9933 22.1162 17.1997 21.9974 18.2961 21.5433C19.3924 21.0892 20.3295 20.3201 20.9888 19.3334C21.6481 18.3467 22 17.1867 22 16C21.9983 14.4092 21.3657 12.884 20.2408 11.7592C19.1159 10.6343 17.5908 10.0017 16 10Z" fill="currentColor" />
  </svg>
);

export const LikesIcon = () => (
  <svg width="15" height="15" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M22.5 4C19.48 4 16.92 5.84 16 8.26C15.08 5.84 12.52 4 9.5 4C5.92 4 3 6.92 3 10.5C3 17.32 9.08 22.46 15.08 27.48L16 28.28L16.92 27.46C22.92 22.46 29 17.32 29 10.5C29 6.92 26.08 4 22.5 4ZM16 25.12C11.02 20.88 5 16.3 5 10.5C5 7.98 6.98 6 9.5 6C12.24 6 14.12 7.94 14.12 10.5H17.88C17.88 7.94 19.76 6 22.5 6C25.02 6 27 7.98 27 10.5C27 16.3 20.98 20.88 16 25.12Z" fill="currentColor" />
  </svg>
);

export const CommentsIcon = () => (
  <svg width="15" height="15" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M27 2H5C3.35 2 2 3.35 2 5V30L8 24H27C28.65 24 30 22.65 30 21V5C30 3.35 28.65 2 27 2ZM27 21H7L4 24V5H27V21Z" fill="currentColor" />
  </svg>
);

export const IconButton: FC<{
  label: string;
  onClick: (e: React.MouseEvent) => void;
  colored?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, colored, children }) => (
  <div
    role="button"
    tabIndex={0}
    aria-label={label}
    data-tooltip-id="tooltip"
    data-tooltip-content={label}
    onClick={onClick}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(e as unknown as React.MouseEvent);
      }
    }}
    className={clsx(
      'hidden group-hover:block hover:underline cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-white/70 rounded-[4px]',
      colored && 'mix-blend-difference'
    )}
  >
    {children}
  </div>
);

export const EditSettings = () => {
  const t = useT();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 32 32"
      fill="none"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('edit_post', 'Edit Post')}
    >
      <path
        d="M26 4L22 8 24 10 28 6 26 4zM20 10L22 12 10 24H8V22L20 10zM6 6V26C6 27.1 6.9 28 8 28H24C25.1 28 26 27.1 26 26V16L22 20V24H8V8H16L20 4H8C6.9 4 6 4.9 6 6z"
        fill="currentColor"
      />
    </svg>
  );
};

export const CopyDebug = () => {
  const t = useT();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('copy_debug_json', 'Copy Debug JSON')}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
};

export const Duplicate = () => {
  const t = useT();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 32 32"
      fill="none"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('duplicate_post', 'Duplicate Post')}
    >
      <path
        d="M27 5H9C8.46957 5 7.96086 5.21071 7.58579 5.58579C7.21071 5.96086 7 6.46957 7 7V9H5C4.46957 9 3.96086 9.21071 3.58579 9.58579C3.21071 9.96086 3 10.4696 3 11V25C3 25.5304 3.21071 26.0391 3.58579 26.4142C3.96086 26.7893 4.46957 27 5 27H23C23.5304 27 24.0391 26.7893 24.4142 26.4142C24.7893 26.0391 25 25.5304 25 25V23H27C27.5304 23 28.0391 22.7893 28.4142 22.4142C28.7893 22.0391 29 21.5304 29 21V7C29 6.46957 28.7893 5.96086 28.4142 5.58579C28.0391 5.21071 27.5304 5 27 5ZM23 11V13H5V11H23ZM23 25H5V15H23V25ZM27 21H25V11C25 10.4696 24.7893 9.96086 24.4142 9.58579C24.0391 9.21071 23.5304 9 23 9H9V7H27V21Z"
        fill="currentColor"
      />
    </svg>
  );
};

export const Preview = () => {
  const t = useT();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 32 32"
      fill="none"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('preview_post', 'Preview Post')}
    >
      <path
        d="M30.9137 15.595C30.87 15.4963 29.8112 13.1475 27.4575 10.7937C24.3212 7.6575 20.36 6 16 6C11.64 6 7.67874 7.6575 4.54249 10.7937C2.18874 13.1475 1.12499 15.5 1.08624 15.595C1.02938 15.7229 1 15.8613 1 16.0012C1 16.1412 1.02938 16.2796 1.08624 16.4075C1.12999 16.5062 2.18874 18.8538 4.54249 21.2075C7.67874 24.3425 11.64 26 16 26C20.36 26 24.3212 24.3425 27.4575 21.2075C29.8112 18.8538 30.87 16.5062 30.9137 16.4075C30.9706 16.2796 31 16.1412 31 16.0012C31 15.8613 30.9706 15.7229 30.9137 15.595ZM16 24C12.1525 24 8.79124 22.6012 6.00874 19.8438C4.86704 18.7084 3.89572 17.4137 3.12499 16C3.89551 14.5862 4.86686 13.2915 6.00874 12.1562C8.79124 9.39875 12.1525 8 16 8C19.8475 8 23.2087 9.39875 25.9912 12.1562C27.1352 13.2912 28.1086 14.5859 28.8812 16C27.98 17.6825 24.0537 24 16 24ZM16 10C14.8133 10 13.6533 10.3519 12.6666 11.0112C11.6799 11.6705 10.9108 12.6075 10.4567 13.7039C10.0026 14.8003 9.88377 16.0067 10.1153 17.1705C10.3468 18.3344 10.9182 19.4035 11.7573 20.2426C12.5965 21.0818 13.6656 21.6532 14.8294 21.8847C15.9933 22.1162 17.1997 21.9974 18.2961 21.5433C19.3924 21.0892 20.3295 20.3201 20.9888 19.3334C21.6481 18.3467 22 17.1867 22 16C21.9983 14.4092 21.3657 12.884 20.2408 11.7592C19.1159 10.6343 17.5908 10.0017 16 10ZM16 20C15.2089 20 14.4355 19.7654 13.7777 19.3259C13.1199 18.8864 12.6072 18.2616 12.3045 17.5307C12.0017 16.7998 11.9225 15.9956 12.0768 15.2196C12.2312 14.4437 12.6122 13.731 13.1716 13.1716C13.731 12.6122 14.4437 12.2312 15.2196 12.0769C15.9956 11.9225 16.7998 12.0017 17.5307 12.3045C18.2616 12.6072 18.8863 13.1199 19.3259 13.7777C19.7654 14.4355 20 15.2089 20 16C20 17.0609 19.5786 18.0783 18.8284 18.8284C18.0783 19.5786 17.0609 20 16 20Z"
        fill="currentColor"
      />
    </svg>
  );
};

export const Statistics = () => {
  const t = useT();
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="15"
      height="15"
      viewBox="0 0 32 32"
      fill="none"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('post_statistics', 'Post Statistics')}
    >
      <path
        d="M28 25H27V5C27 4.73478 26.8946 4.48043 26.7071 4.29289C26.5196 4.10536 26.2652 4 26 4H19C18.7348 4 18.4804 4.10536 18.2929 4.29289C18.1054 4.48043 18 4.73478 18 5V10H12C11.7348 10 11.4804 10.1054 11.2929 10.2929C11.1054 10.4804 11 10.7348 11 11V16H6C5.73478 16 5.48043 16.1054 5.29289 16.2929C5.10536 16.4804 5 16.7348 5 17V25H4C3.73478 25 3.48043 25.1054 3.29289 25.2929C3.10536 25.4804 3 25.7348 3 26C3 26.2652 3.10536 26.5196 3.29289 26.7071C3.48043 26.8946 3.73478 27 4 27H28C28.2652 27 28.5196 26.8946 28.7071 26.7071C28.8946 26.5196 29 26.2652 29 26C29 25.7348 28.8946 25.4804 28.7071 25.2929C28.5196 25.1054 28.2652 25 28 25ZM20 6H25V25H20V6ZM13 12H18V25H13V12ZM7 18H11V25H7V18Z"
        fill="currentColor"
      />
    </svg>
  );
};

export const DeletePost = () => {
  const t = useT();
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-tooltip-id="tooltip"
      data-tooltip-content={t('delete_post', 'Delete Post')}
    >
      <path
        d="M15 10V18H9V10H15ZM14 4H9.9L8.9 5H6V7H18V5H15L14 4ZM17 8H7V18C7 19.1 7.9 20 9 20H15C16.1 20 17 19.1 17 18V8Z"
        fill="currentColor"
      />
    </svg>
  );
};

const ChangeColorModalBody: FC<{
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

export const usePostActions = (onMutate?: () => void) => {
  const t = useT();
  const fetch = useFetch();
  const modal = useModals();
  const toaster = useToaster();
  const router = useRouter();
  const { integrations, posts, reloadCalendarView } = useCalendar();
  const [statsPostId, setStatsPostId] = useState<string | null>(null);

  const mutate = useCallback(() => {
    reloadCalendarView();
    onMutate?.();
  }, [reloadCalendarView, onMutate]);

  const editPost = useCallback(
    (loadPost: Post & { actualDate?: string }, isDuplicate?: boolean) =>
      async () => {
      if (!isDuplicate) {
        router.push(`/posts/post/${loadPost.group}`);
        return;
      }

      const post = {
        ...loadPost,
        publishDate: loadPost.actualDate || loadPost.publishDate,
      };

      const data = await (await fetch(`/posts/group/${post.group}`)).json();
      const date = (await (await fetch('/posts/find-slot')).json()).date;
      const publishDate = dayjs.utc(date).local();
      modal.openModal({
        id: 'add-edit-modal',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <Fragment>
            <Composer
              onlyValues={data.posts.map(
                ({
                  image,
                  settings,
                  content,
                }: Pick<Post, 'image' | 'settings' | 'content'>) => ({
                  image,
                  settings,
                  content,
                })
              )}
              allIntegrations={integrations.map((p) => ({ ...p }))}
              reopenModal={() => router.push(`/posts/post/${post.group}`)}
              mutate={mutate}
              integrations={integrations}
              date={publishDate}
            />
          </Fragment>
        ),
        size: '80%',
        title: ``,
      });
    },
    [integrations, fetch, modal, mutate, router]
  );

  const copyDebugJson = useCallback(
    (post: any) => async () => {
      try {
        const data = await (
          await fetch(`/posts/group/${post.group}/debug-export`)
        ).json();
        copy(JSON.stringify(data, null, 2));
        toaster.show(
          t('debug_json_copied', 'Debug JSON copied to clipboard'),
          'success'
        );
      } catch {
        toaster.show(
          t('debug_json_copy_failed', 'Failed to copy debug data'),
          'warning'
        );
      }
    },
    [fetch, toaster, t]
  );

  const deletePost = useCallback(
    (post: any) => async () => {
      // Deleting one card removes the whole group (`/posts/:group`) — every
      // channel it publishes to. Disclose that scope when the group spans more
      // than one integration.
      const distinctIntegrations = new Set(
        (posts || [])
          .filter((p: any) => p.group === post.group)
          .map((p: any) => p.integration?.id)
      );
      const confirmMessage =
        distinctIntegrations.size > 1
          ? t(
              'delete_post_group_scope',
              'This post is scheduled to multiple channels — deleting it removes it from all of them. Are you sure?'
            )
          : t(
              'are_you_sure_you_want_to_delete_post',
              'Are you sure you want to delete this post?'
            );
      if (!(await deleteDialog(confirmMessage))) {
        return;
      }

      const res = await fetch(`/posts/${post.group}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        toaster.show(
          t('post_delete_failed', 'Failed to delete post'),
          'warning'
        );
        return;
      }

      toaster.show(
        t('post_deleted_successfully', 'Post deleted successfully'),
        'success'
      );

      mutate();
    },
    [toaster, t, fetch, mutate, posts]
  );

  const openStatistics = useCallback(
    (id: string) => () => {
      setStatsPostId(id);
    },
    []
  );

  const openMissingRelease = useCallback(
    (id: string) => () => {
      modal.openModal({
        title: t('connect_post', 'Connect Post'),
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        classNames: {
          modal: 'w-[100%] max-w-[800px]',
        },
        children: (
          <MissingReleaseModal
            postId={id}
            onSuccess={mutate}
            onShowStatistics={setStatsPostId}
          />
        ),
        size: '60%',
      });
    },
    [modal, t, mutate]
  );

  const openPostDetail = useCallback(
    (post: any) => (e: React.MouseEvent) => {
      e.stopPropagation();
      modal.openModal({
        title: '',
        closeOnClickOutside: true,
        closeOnEscape: true,
        withCloseButton: true,
        classNames: {
          modal: 'w-[100%] max-w-[1100px] text-textColor',
        },
        children: <PostDetailModal postId={post.id} />,
        size: '80%',
      });
    },
    [modal]
  );

  const changeColor = useCallback(
    (post: Post & { color?: string | null }) => () => {
      modal.openModal({
        title: t('change_color', 'Change color'),
        withCloseButton: true,
        children: (
          <ChangeColorModalBody
            initial={post.color ?? null}
            onApply={async (color) => {
              const res = await fetch(`/posts/group/${post.group}/color`, {
                method: 'PUT',
                body: JSON.stringify({ color }),
              });

              if (!res.ok) {
                toaster.show(
                  t('color_update_failed', 'Failed to update color'),
                  'warning'
                );
                return;
              }

              modal.closeAll();
              toaster.show(t('color_updated', 'Color updated'), 'success');
              mutate();
            }}
          />
        ),
      });
    },
    [modal, fetch, mutate, toaster, t]
  );

  const postAnalyticsDrawer = (
    <PostAnalyticsDrawer
      postId={statsPostId ?? ''}
      open={!!statsPostId}
      onClose={() => setStatsPostId(null)}
    />
  );

  return { editPost, deletePost, copyDebugJson, openStatistics, openMissingRelease, openPostDetail, changeColor, postAnalyticsDrawer };
};
