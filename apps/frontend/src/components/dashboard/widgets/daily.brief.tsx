'use client';

import { FC, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useDailyBrief } from '../hooks/useDailyBrief';
import { useAiActive, AI_SETUP_HREF } from '@gitroom/frontend/components/layout/use-ai-active';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { TabSkeleton } from '@gitroom/frontend/components/analytics-v2/kit/states';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const MAX_TEASER_LENGTH = 80;

const teaser = (text: string) => {
  if (text.length <= MAX_TEASER_LENGTH) return text;
  return text.slice(0, MAX_TEASER_LENGTH).replace(/\s+\S*$/, '') + '…';
};

const SparkleIcon: FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .962 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .962L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.962 0z" />
  </svg>
);

interface DailyBriefProps {
  open?: boolean;
}

export const DailyBrief: FC<DailyBriefProps> = ({ open }) => {
  const router = useRouter();
  const aiActive = useAiActive();
  const { data, error, isLoading, generate } = useDailyBrief();
  const toaster = useToaster();
  const t = useT();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const expanded = open ?? internalExpanded;
  const setExpanded = (v: boolean | ((prev: boolean) => boolean)) => {
    if (open === undefined) setInternalExpanded(v);
  };

  if (aiActive === false) return null;

  const cached = data && 'brief' in data ? data : undefined;
  const empty = data && 'cached' in data ? data : undefined;
  const statusError = error as any;

  const handleExpand = async () => {
    setExpanded(true);
    if (cached) return;
    setGenerating(true);
    try {
      await generate();
    } catch (err: any) {
      if (err?.status === 503) {
        toaster.show(
          t(
            'ai_not_configured_redirect',
            'AI is not configured. Redirecting to AI settings...'
          ),
          'warning'
        );
        router.push(AI_SETUP_HREF);
      } else if (err?.status === 429) {
        toaster.show(
          t('ai_budget_exceeded_upgrade', 'AI budget exceeded. Upgrade or wait for reset.'),
          'warning'
        );
      } else {
        toaster.show(
          err?.messageKey ? t(err.messageKey, err.message) : err?.message || t('could_not_generate_brief', 'Could not generate brief'),
          'warning'
        );
      }
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] overflow-hidden">
      <button
        type="button"
        onClick={handleExpand}
        className="w-full flex items-center justify-between gap-[12px] px-[16px] py-[12px] text-start hover:bg-newTableHeader transition-colors"
      >
        <div className="flex items-center gap-[10px] min-w-0">
          <SparkleIcon className="text-amber-500 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[13px] font-medium text-textColor truncate">
              {t('daily_brief', 'Daily Brief')}
            </h2>
            {cached ? (
              <p className="text-[12px] text-newTableText truncate">
                {teaser(cached.brief)}
              </p>
            ) : (
              <p className="text-[12px] text-newTableText truncate">
                {empty
                  ? t('generate_daily_ai_summary', 'Generate your daily AI summary')
                  : t('loading_ellipsis', 'Loading…')}
              </p>
            )}
          </div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-newTableText shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {expanded && (
        <div className="px-[16px] pb-[16px] pt-[4px]">
          {isLoading || generating ? (
            <TabSkeleton variant="list" />
          ) : cached ? (
            <div className="flex flex-col gap-[10px]">
              <p data-testid="daily-brief-body" className="text-[13px] text-textColor leading-relaxed whitespace-pre-line">
                {cached.brief}
              </p>
              <div className="flex items-center justify-between gap-[12px]">
                <span className="text-[11px] text-newTableText">
                  {t('generated_by_ai', 'Generated by AI')}
                </span>
                <Button
                  secondary
                  onClick={async () => {
                    setGenerating(true);
                    try {
                      await generate();
                    } catch (err: any) {
                      toaster.show(
                        err?.messageKey
                          ? t(err.messageKey, err.message)
                          : err?.message ||
                              t('could_not_regenerate_brief', 'Could not regenerate brief'),
                        'warning'
                      );
                    } finally {
                      setGenerating(false);
                    }
                  }}
                  className="px-[10px] py-[4px] text-[11px]"
                >
                  {t('regenerate', 'Regenerate')}
                </Button>
              </div>
            </div>
          ) : statusError?.status === 429 ? (
            <p className="text-[13px] text-textColor">
              {t(
                'ai_budget_exceeded_resume',
                'AI budget exceeded. Briefs will resume after your budget resets.'
              )}
            </p>
          ) : (
            <div className="flex flex-col gap-[10px]">
              <p className="text-[13px] text-textColor">
                {t('no_brief_yet_today', 'No brief yet for today. Click above to generate one.')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
