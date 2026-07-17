'use client';

import { FC, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAttention, AttentionItemDto } from '../hooks/useAttention';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { Button } from '@gitroom/react/form/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const severityBorder: Record<string, string> = {
  critical: 'border-l-[var(--negative,#f97066)]',
  warning: 'border-l-amber-500',
  info: 'border-l-newTableBorder',
  default: 'border-l-newTableBorder',
};

const severityIconBg: Record<string, string> = {
  critical: 'bg-[var(--negative,#f97066)]/10 text-[var(--negative,#f97066)]',
  warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  info: 'bg-newTableBorder text-newTableText',
  default: 'bg-newTableBorder text-newTableText',
};

const kindLink = (item: AttentionItemDto): string => {
  switch (item.kind) {
    case 'failed-posts':
      return '/posts';
    case 'channel-health':
      return '/settings?tab=channels';
    case 'pending-approvals':
      return item.link || '/campaigns';
    case 'unread-comments':
      return '/replies';
    case 'schedule-gaps':
      return item.link || '/posts/post';
    case 'budget':
      return item.link || '/billing';
    case 'failed-media-jobs':
      return '/media';
    case 'anomalies':
      return '/analytics?tab=insights';
    default:
      return item.link || '#';
  }
};

const ChevronIcon: FC<{ open: boolean }> = ({ open }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const AttentionRow: FC<{
  item: AttentionItemDto;
  onRetry?: (postId: string) => Promise<void>;
  onDismiss?: (anomalyId: string) => Promise<void>;
}> = ({ item, onRetry, onDismiss }) => {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(false);
  const toaster = useToaster();
  const t = useT();

  const payloadPosts = item.action?.payload?.posts as
    | Array<{ id: string; channelName?: string; content?: string; error?: string }>
    | undefined;

  const handleRetry = async (postId: string) => {
    if (!onRetry) return;
    setWorking(true);
    try {
      await onRetry(postId);
      toaster.show(t('post_queued_for_retry', 'Post queued for retry'), 'success');
    } catch (err: any) {
      toaster.show(
        err?.messageKey ? t(err.messageKey, err.message) : err?.message || t('retry_failed', 'Retry failed'),
        'warning'
      );
    } finally {
      setWorking(false);
    }
  };

  const handleDismiss = async () => {
    if (!onDismiss) return;
    setWorking(true);
    try {
      await onDismiss(item.id);
    } catch (err: any) {
      toaster.show(
        err?.messageKey ? t(err.messageKey, err.message) : err?.message || t('dismiss_failed', 'Dismiss failed'),
        'warning'
      );
    } finally {
      setWorking(false);
    }
  };

  return (
    <div
      className={`rounded-[10px] border border-newTableBorder border-l-[3px] ${severityBorder[item.severity] || severityBorder.default} bg-newTableHeader overflow-hidden`}
    >
      <div className="flex items-start gap-[10px] p-[12px]">
        <div
          className={`shrink-0 w-[28px] h-[28px] rounded-full flex items-center justify-center ${severityIconBg[item.severity] || severityIconBg.default}`}
        >
          {item.severity === 'critical' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 8v4" strokeLinecap="round" />
              <path d="M12 16h.01" strokeLinecap="round" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          ) : item.severity === 'warning' ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 9v4" strokeLinecap="round" />
              <path d="M12 17h.01" strokeLinecap="round" />
              <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10Z" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 16v-4" strokeLinecap="round" />
              <path d="M12 8h.01" strokeLinecap="round" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-[8px]">
            <h3 className="text-[13px] font-medium text-textColor truncate">
              {item.title}
            </h3>
            {typeof item.count === 'number' && item.count > 0 && (
              <span className="shrink-0 min-w-[18px] h-[18px] px-[5px] flex items-center justify-center rounded-full bg-btnPrimary text-[10px] font-semibold text-white">
                {item.count > 99 ? '99+' : item.count}
              </span>
            )}
          </div>
          {item.description && (
            <p className="text-[12px] text-newTableText mt-[2px] line-clamp-2">
              {item.description}
            </p>
          )}

          {item.kind === 'failed-posts' && payloadPosts && payloadPosts.length > 0 && (
            <div className="mt-[10px]">
              <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="inline-flex items-center gap-[6px] min-h-[40px] py-[8px] text-[12px] text-newTableText hover:text-textColor transition-colors"
              >
                <ChevronIcon open={expanded} />
                {expanded
                  ? t('hide_failed_posts', 'Hide failed posts')
                  : t(
                      'show_failed_posts_count',
                      'Show {{count}} failed post',
                      {
                        count: payloadPosts.length,
                      }
                    )}
              </button>

              {expanded && (
                <div className="mt-[8px] flex flex-col gap-[6px]">
                  {payloadPosts.map((post) => (
                    <div
                      key={post.id}
                      className="flex items-center gap-[8px] p-[8px] rounded-[8px] bg-newBgColorInner border border-newTableBorder"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-textColor truncate">
                          {post.channelName || t('channel_label', 'Channel')}
                        </p>
                        {post.error && (
                          <p className="text-[11px] text-newTableText truncate">
                            {post.error}
                          </p>
                        )}
                      </div>
                      {onRetry && (
                        <Button
                          onClick={() => handleRetry(post.id)}
                          disabled={working}
                          className="px-[10px] py-[4px] text-[11px] shrink-0"
                        >
                          {t('retry', 'Retry')}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-[6px] shrink-0">
          {item.kind === 'anomalies' && onDismiss && (
            <button
              type="button"
              onClick={handleDismiss}
              disabled={working}
              aria-label={t('dismiss_anomaly_aria', 'Dismiss anomaly')}
              className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-[6px] text-newTableText hover:text-textColor hover:bg-newTableBorder transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18" strokeLinecap="round" />
                <path d="m6 6 12 12" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {item.action?.type !== 'retry-post' && (
            <button
              type="button"
              onClick={() => router.push(kindLink(item))}
              className="inline-flex items-center justify-center min-h-[40px] px-[12px] py-[8px] text-[12px] font-medium rounded-[6px] bg-btnPrimary text-white hover:bg-btnPrimary/90 transition-colors"
            >
              {item.action?.label || t('view', 'View')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const AllClear: FC = () => {
  const t = useT();
  return (
    <div className="flex items-center gap-[10px] p-[12px] rounded-[10px] border border-newTableBorder border-l-[3px] border-l-[var(--positive,#32d583)] bg-newTableHeader">
      <div className="shrink-0 w-[28px] h-[28px] rounded-full bg-[var(--positive,#32d583)]/10 text-[var(--positive,#32d583)] flex items-center justify-center">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <div>
        <h3 className="text-[13px] font-medium text-textColor">{t('all_clear', 'All clear')}</h3>
        <p className="text-[12px] text-newTableText">
          {t('nothing_needs_attention', 'Nothing needs your attention right now.')}
        </p>
      </div>
    </div>
  );
};

export const AttentionFeed: FC = () => {
  const { data, isLoading, retryPost, dismissAnomaly } = useAttention();

  if (isLoading) {
    return <TabSkeleton variant="list" />;
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return <AllClear />;
  }

  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 2 };
  const sorted = [...items].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity]
  );

  return (
    <div className="flex flex-col gap-[8px]">
      {sorted.map((item) => (
        <AttentionRow
          key={item.id}
          item={item}
          onRetry={item.kind === 'failed-posts' ? retryPost : undefined}
          onDismiss={item.kind === 'anomalies' ? dismissAnomaly : undefined}
        />
      ))}
    </div>
  );
};
