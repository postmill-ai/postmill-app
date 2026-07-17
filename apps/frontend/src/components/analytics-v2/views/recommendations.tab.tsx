'use client';

import { FC } from 'react';
import { useRouter } from 'next/navigation';
import { useRecommendations, RecommendationItem } from '../hooks/useRecommendations';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TabSkeleton, EmptyState, ErrorState } from '../kit/states';

const PRIORITY_COLORS: Record<number, string> = {
  1: 'text-priorityHigh border-priorityHigh',
  2: 'text-priorityMedium border-priorityMedium',
  3: 'text-priorityLow border-priorityLow',
};

export const RecommendationsTab: FC = () => {
  const t = useT();
  const router = useRouter();
  const { data, isLoading, error, mutate } = useRecommendations();
  const priorityLabels: Record<number, string> = {
    1: t('priority_high', 'High'),
    2: t('priority_medium', 'Medium'),
    3: t('priority_low', 'Low'),
  };

  if (isLoading) {
    return <TabSkeleton variant="list" />;
  }

  if (error) {
    return (
      <ErrorState
        title={t('recommendations_load_error', 'Failed to load recommendations')}
        onRetry={() => mutate()}
      />
    );
  }

  const items = data?.recommendations || [];

  if (items.length === 0) {
    return (
      <EmptyState
        title={t('recommendations_empty_title', 'No recommendations yet')}
        description={t(
          'recommendations_empty',
          'Connect more channels and publish posts to get actionable insights.'
        )}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
      {items.map((item: RecommendationItem) => (
        <div
          key={`${item.type}-${item.title}`}
          className="bg-newBgColorInner rounded-[12px] border border-newTableBorder p-[20px] flex flex-col gap-[12px]"
        >
          <div className="flex items-center gap-[8px]">
            <span
              className={`text-[11px] font-semibold px-[8px] py-[2px] rounded-full border ${PRIORITY_COLORS[item.priority] || 'text-newTableText border-newTableText'}`}
            >
              {priorityLabels[item.priority] || t('priority_info', 'Info')}
            </span>
            <span className="text-[11px] text-newTableText capitalize">
              {t(`recommendation_type_${item.type}`, item.type.replace(/_/g, ' '))}
            </span>
          </div>
          <h3 className="text-[15px] font-semibold text-textColor">{item.title}</h3>
          <p className="text-[13px] text-newTableText leading-relaxed">{item.description}</p>
          <button
            onClick={() => router.push(item.link)}
            className="self-start mt-auto px-[14px] py-[6px] bg-btnPrimary text-white text-[13px] font-medium rounded-[8px] transition-colors hover:opacity-80"
          >
            {item.action}
          </button>
        </div>
      ))}
    </div>
  );
};
