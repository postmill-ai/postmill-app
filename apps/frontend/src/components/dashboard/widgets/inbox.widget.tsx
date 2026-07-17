'use client';

import { FC, useMemo } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useRouter } from 'next/navigation';
import { useInboxPreview } from '../hooks/useInboxPreview';
import { ChannelAvatar } from '@gitroom/frontend/components/analytics-v2/kit/channel-avatar';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

dayjs.extend(relativeTime);

const snippet = (content: string, max = 60) => {
  const text = content.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
};

export const InboxWidget: FC = () => {
  const router = useRouter();
  const t = useT();
  const { data, isLoading } = useInboxPreview(4);

  const comments = data?.comments ?? [];

  if (isLoading) return <TabSkeleton variant="list" />;
  if (!comments.length) return null;

  return (
    <div className="flex flex-col gap-[8px]">
      <div className="flex items-center gap-[8px] mb-[4px]">
        <span className="text-[13px] font-medium text-textColor">
          {t('n_unread', '{{count}} unread', { count: comments.length })}
        </span>
        {comments.length > 4 && (
          <span className="text-[11px] text-newTableText">
            {t('showing_4', 'showing 4')}
          </span>
        )}
      </div>
      {comments.map((comment) => (
        <button
          key={comment.id}
          type="button"
          onClick={() => router.push('/replies')}
          className="flex items-start gap-[10px] p-[10px] rounded-[10px] bg-newTableHeader border border-newTableBorder hover:border-newTableText transition-colors text-start"
        >
          <ChannelAvatar
            src={comment.authorPicture ?? undefined}
            identifier={comment.post?.integration?.providerIdentifier ?? undefined}
            name={comment.authorName}
            size={28}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-[8px]">
              <span className="text-[12px] font-medium text-textColor truncate">
                {comment.authorName}
              </span>
              <span className="text-[11px] text-newTableText shrink-0">
                {dayjs(comment.platformCreatedAt).fromNow()}
              </span>
            </div>
            <p className="text-[12px] text-newTableText truncate">
              {snippet(comment.content)}
            </p>
            {comment.post?.integration && (
              <div className="mt-[4px] flex items-center gap-[4px] text-[10px] text-newTableText">
                <ChannelAvatar
                  src={comment.post.integration.picture ?? undefined}
                  identifier={comment.post.integration.providerIdentifier ?? undefined}
                  name={comment.post.integration.name}
                  size={12}
                />
                <span className="truncate">{comment.post.integration.name}</span>
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
};
