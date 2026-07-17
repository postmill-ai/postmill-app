'use client';

import { FC, useMemo } from 'react';
import dayjs from 'dayjs';
import { useRouter } from 'next/navigation';
import { useSchedule } from '../hooks/useSchedule';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { ChannelAvatar } from '@gitroom/frontend/components/analytics-v2/kit/channel-avatar';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface UpcomingPost {
  id: string;
  content: string | null;
  publishDate: string;
  channelName: string | null;
  providerIdentifier: string | null;
}

interface ScheduleTimelineProps {
  upcomingPosts?: UpcomingPost[];
}

const ComposerFillButton: FC<{ date: string }> = ({ date }) => {
  const router = useRouter();
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => router.push(`/posts/post?date=${date}T10:00:00`)}
      className="mt-[8px] inline-flex items-center justify-center min-h-[40px] px-[12px] py-[8px] text-[12px] font-medium rounded-[6px] bg-btnPrimary text-white hover:bg-btnPrimary/90 transition-colors"
    >
      {t('fill_button', 'Fill')}
    </button>
  );
};

export const ScheduleTimeline: FC<ScheduleTimelineProps> = ({ upcomingPosts = [] }) => {
  const t = useT();
  const { data: schedule, isLoading } = useSchedule(7);

  const postsByDay = useMemo(() => {
    const map = new Map<string, UpcomingPost[]>();
    if (!upcomingPosts) return map;
    for (const post of upcomingPosts) {
      const day = dayjs(post.publishDate).format('YYYY-MM-DD');
      if (!map.has(day)) map.set(day, []);
      map.get(day)!.push(post);
    }
    return map;
  }, [upcomingPosts]);

  if (isLoading) {
    return <TabSkeleton variant="list" />;
  }

  if (!schedule?.days.length) {
    return (
      <EmptyState
        title={t('no_schedule_data_title', 'No schedule data')}
        description={t('no_schedule_data_description', 'Create a post to fill your calendar.')}
      />
    );
  }

  return (
    <div className="flex gap-[8px] overflow-x-auto pb-[8px]">
      {schedule.days.map((day) => {
        const isGap = schedule.gaps.includes(day.date);
        const dayPosts = postsByDay.get(day.date) ?? [];
        const label = dayjs(day.date).format(t('schedule_day_abbrev_format', 'ddd'));
        const dateNum = dayjs(day.date).format(t('schedule_day_number_format', 'D'));
        return (
          <div
            key={day.date}
            className={`flex-shrink-0 w-[120px] mobile:w-[100px] rounded-[10px] border p-[10px] flex flex-col gap-[8px] ${
              isGap ? 'border-amber-500/40 bg-amber-500/5' : 'border-newTableBorder bg-newTableHeader'
            }`}
          >
            <div className="flex items-baseline justify-between">
              <span className="text-[12px] font-medium text-textColor">{label}</span>
              <span className="text-[16px] font-semibold text-textColor">{dateNum}</span>
            </div>
            <div className="text-[24px] font-semibold text-textColor leading-none">
              {day.count}
            </div>
            <div className="text-[11px] text-newTableText">
              {day.count === 1 ? t('post_lower', 'post') : t('posts_lower', 'posts')}
            </div>

            <div className="flex flex-col gap-[6px] min-h-[44px]">
              {dayPosts.slice(0, 2).map((post) => (
                <div
                  key={post.id}
                  className="flex items-center gap-[6px] text-[11px] text-newTableText truncate"
                  title={post.content ?? undefined}
                >
                  <ChannelAvatar
                    identifier={post.providerIdentifier ?? undefined}
                    name={post.channelName ?? undefined}
                    size={16}
                  />
                  <span className="truncate">{post.content || t('untitled', 'Untitled')}</span>
                </div>
              ))}
            </div>

            {isGap && <ComposerFillButton date={day.date} />}
          </div>
        );
      })}
    </div>
  );
};
