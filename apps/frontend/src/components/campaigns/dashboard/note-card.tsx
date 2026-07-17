'use client';

import { FC, useState, useCallback } from 'react';
import clsx from 'clsx';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SafeContent } from '@gitroom/frontend/components/shared/safe-content';
import { KebabMenu } from '@gitroom/frontend/components/ui/kebab-menu';
import { DiscussionEditor } from '@gitroom/frontend/components/campaigns/dashboard/discussion-editor';
import { DiscussionNote } from '@gitroom/frontend/components/campaigns/hooks/campaign.hooks';

dayjs.extend(relativeTime);

const QUICK_EMOJI = ['👍', '❤️', '🎉', '👀', '😄'];

interface NoteCardProps {
  note: DiscussionNote;
  campaignId: string;
  isReply?: boolean;
  loadList: (query: string) => Promise<{ id: string; label: string; image: string }[]>;
  onMutate: () => void;
}

const UserAvatar: FC<{ url?: string | null; name?: string; size?: number }> = ({
  url,
  name,
  size = 32,
}) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={url || '/no-picture.jpg'}
    alt={name || ''}
    width={size}
    height={size}
    className="rounded-full object-cover shrink-0"
    style={{ width: size, height: size }}
  />
);

export const NoteCard: FC<NoteCardProps> = ({
  note,
  campaignId,
  isReply,
  loadList,
  onMutate,
}) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const resolved = !!note.resolvedAt;

  const call = useCallback(
    async (url: string, method: string, body?: any) => {
      setBusy(true);
      try {
        const r = await fetch(url, {
          method,
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!r.ok) {
          toaster.show(t('action_failed', 'Something went wrong'), 'warning');
          return false;
        }
        onMutate();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [fetch, onMutate, toaster, t]
  );

  const submitReply = useCallback(
    async (content: string) => {
      const ok = await call(`/campaigns/${campaignId}/notes`, 'POST', {
        content,
        parentId: note.id,
      });
      if (ok) setReplying(false);
    },
    [call, campaignId, note.id]
  );

  const submitEdit = useCallback(
    async (content: string) => {
      const ok = await call(`/campaigns/${campaignId}/notes/${note.id}`, 'PUT', {
        content,
      });
      if (ok) setEditing(false);
    },
    [call, campaignId, note.id]
  );

  const toggleReaction = useCallback(
    (emoji: string) => {
      setEmojiOpen(false);
      call(`/campaigns/${campaignId}/notes/${note.id}/reactions`, 'POST', { emoji });
    },
    [call, campaignId, note.id]
  );

  const kebabItems = [
    ...(note.isOwn
      ? [
          { label: t('edit', 'Edit'), onClick: () => setEditing(true) },
          {
            label: t('delete', 'Delete'),
            danger: true,
            onClick: () =>
              call(`/campaigns/${campaignId}/notes/${note.id}`, 'DELETE'),
          },
        ]
      : []),
    {
      label: note.pinned ? t('unpin', 'Unpin') : t('pin', 'Pin'),
      onClick: () =>
        call(`/campaigns/${campaignId}/notes/${note.id}/pin`, 'POST', {
          pinned: !note.pinned,
        }),
    },
    {
      label: resolved ? t('unresolve', 'Unresolve') : t('resolve', 'Resolve'),
      onClick: () =>
        call(`/campaigns/${campaignId}/notes/${note.id}/resolve`, 'POST', {
          resolved: !resolved,
        }),
    },
  ];

  return (
    <div
      className={clsx(
        'rounded-[8px] border border-newTableBorder bg-newBgColorInner p-[12px] flex flex-col gap-[8px]',
        resolved && 'opacity-60',
        isReply && 'ms-[24px]'
      )}
    >
      <div className="flex items-start gap-[10px]">
        <UserAvatar url={note.author?.avatarUrl} name={note.author?.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[8px] flex-wrap">
            <span className="text-[13px] font-semibold text-textColor">
              {note.author?.name || t('unknown', 'Unknown')}
            </span>
            <span className="text-[11px] text-newTableText">
              {dayjs(note.createdAt).fromNow()}
            </span>
            {note.editedAt && (
              <span className="text-[11px] text-newTableText">({t('edited', 'edited')})</span>
            )}
            {note.pinned && (
              <span className="text-[11px] text-btnPrimary">📌 {t('pinned', 'Pinned')}</span>
            )}
            {resolved && (
              <span className="text-[11px] text-newTableText">✓ {t('resolved_label', 'Resolved')}</span>
            )}
          </div>
        </div>
        <KebabMenu ariaLabel={t('note_actions', 'Note actions')} align="right" items={kebabItems} />
      </div>

      {editing ? (
        <DiscussionEditor
          initialContent={note.content}
          onSubmit={submitEdit}
          submitting={busy}
          submitLabel={t('save', 'Save')}
          focusOnMount
          onCancel={() => setEditing(false)}
          loadList={loadList}
        />
      ) : (
        <SafeContent
          className="note-body text-[13px] text-textColor break-words"
          content={note.content}
        />
      )}

      {/* Reaction bar */}
      <div className="flex items-center gap-[6px] flex-wrap relative">
        {note.reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            disabled={busy}
            onClick={() => toggleReaction(r.emoji)}
            className={clsx(
              'flex items-center gap-[4px] h-[24px] px-[8px] rounded-full border text-[12px] transition-colors',
              r.reactedByMe
                ? 'border-btnPrimary bg-btnPrimary/10 text-textColor'
                : 'border-newTableBorder text-newTableText hover:text-textColor'
            )}
          >
            <span>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setEmojiOpen((v) => !v)}
          className="h-[24px] px-[8px] rounded-full border border-newTableBorder text-[12px] text-newTableText hover:text-textColor"
        >
          ＋
        </button>
        {emojiOpen && (
          <div className="absolute z-[50] top-[28px] left-0 flex items-center gap-[4px] p-[6px] rounded-[8px] border border-newTableBorder bg-newBgColorInner shadow-lg">
            {QUICK_EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => toggleReaction(e)}
                className="w-[28px] h-[28px] rounded-[6px] hover:bg-boxHover text-[16px]"
              >
                {e}
              </button>
            ))}
          </div>
        )}
        {!isReply && (
          <button
            type="button"
            onClick={() => setReplying((v) => !v)}
            className="h-[24px] px-[8px] text-[12px] text-newTableText hover:text-textColor ms-[4px]"
          >
            {t('reply', 'Reply')}
          </button>
        )}
      </div>

      {replying && (
        <DiscussionEditor
          placeholder={t('write_a_reply_placeholder', 'Write a reply…')}
          onSubmit={submitReply}
          submitting={busy}
          submitLabel={t('reply', 'Reply')}
          focusOnMount
          onCancel={() => setReplying(false)}
          loadList={loadList}
        />
      )}

      {/* Replies (one level) */}
      {note.replies?.length > 0 && (
        <div className="flex flex-col gap-[8px] mt-[4px]">
          {note.replies.map((r) => (
            <NoteCard
              key={r.id}
              note={r}
              campaignId={campaignId}
              isReply
              loadList={loadList}
              onMutate={onMutate}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default NoteCard;
