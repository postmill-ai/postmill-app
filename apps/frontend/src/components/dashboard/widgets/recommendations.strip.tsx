'use client';

import { FC } from 'react';
import { useRouter } from 'next/navigation';
import {
  useRecommendations,
  RecommendationItem,
} from '@gitroom/frontend/components/analytics-v2/hooks/useRecommendations';
import { EmptyState, TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const priorityClass = (priority: number) => {
  const base = 'text-[10px] font-semibold px-[6px] py-[2px] rounded-full border';
  if (priority === 1) return `${base} text-[var(--negative,#f97066)] border-[var(--negative,#f97066)]`;
  if (priority === 2) return `${base} text-amber-700 dark:text-amber-400 border-amber-500`;
  return `${base} text-[var(--chart-3,#1d9bf0)] border-[var(--chart-3,#1d9bf0)]`;
};

export const RecommendationsStrip: FC = () => {
  const router = useRouter();
  const t = useT();
  const { data, isLoading } = useRecommendations();

  if (isLoading) return <TabSkeleton variant="list" />;

  const items: RecommendationItem[] = data?.recommendations?.slice(0, 4) ?? [];

  if (!items.length) return null;

  return (
    <div className="flex flex-col gap-[10px]">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-[12px]">
        {items.map((item) => (
          <div
            key={`${item.type}-${item.title}`}
            className="bg-newTableHeader border border-newTableBorder rounded-[10px] p-[14px] flex flex-col gap-[8px]"
          >
            <div className="flex items-center gap-[8px]">
              <span className={priorityClass(item.priority)}>
                {item.priority === 1
                  ? t('priority_high', 'High')
                  : item.priority === 2
                    ? t('priority_medium', 'Medium')
                    : t('priority_low', 'Low')}
              </span>
              <span className="text-[11px] text-newTableText capitalize">
                {item.type.replace(/_/g, ' ')}
              </span>
            </div>
            <h3 className="text-[13px] font-semibold text-textColor line-clamp-2">
              {item.title}
            </h3>
            <p className="text-[11px] text-newTableText leading-relaxed line-clamp-2">
              {item.description}
            </p>
            <button
              type="button"
              onClick={() => router.push(item.link)}
              className="self-start mt-auto inline-flex items-center justify-center min-h-[40px] px-[12px] py-[8px] bg-btnPrimary text-white text-[12px] font-medium rounded-[6px] hover:bg-btnPrimary/90 transition-colors"
            >
              {item.action}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
