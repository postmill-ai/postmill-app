'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { AiErrorDisplay } from '@gitroom/frontend/components/ai/ai-error-display';

const AiBestTimeModal: FC<{ close: () => void }> = (props) => {
  const { close } = props;
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    suggestion: string;
    hasAnalyticsData: boolean;
  } | null>(null);
  const [error, setError] = useState<any>(null);

  const loadBestTime = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/ai/best-time', {
        method: 'POST',
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({
          message: t(
            'best_time_analysis_unavailable',
            'Best time analysis is temporarily unavailable'
          ),
        }));
        setError(err);
        return;
      }

      const data = await res.json();
      setResult(data);
    } catch {
      setError(
        t(
          'best_time_analysis_unavailable',
          'Best time analysis is temporarily unavailable'
        )
      );
    } finally {
      setLoading(false);
    }
  }, [fetch, t]);

  return (
    <div className="flex flex-col gap-[16px]">
      {!result && (
        <div className="flex">
          <button
            onClick={loadBestTime}
            disabled={loading}
            className="cursor-pointer text-white disabled:opacity-80 disabled:cursor-not-allowed w-full h-[42px] px-[20px] items-center justify-center bg-btnPrimary flex rounded-[6px]"
          >
            {loading ? (
              <Loading height={16} width={16} type="spin" color="#fff" />
            ) : (
              t('analyze_best_times', 'Analyze Best Times')
            )}
          </button>
        </div>
      )}

      {error && (
        <AiErrorDisplay error={error} onDismiss={() => setError(null)} />
      )}

      {result && (
        <>
          <div
            className={clsx(
              'text-[11px] font-[600] px-[10px] py-[4px] rounded-[4px] w-fit',
              result.hasAnalyticsData
                ? 'bg-green-400/10 text-green-800 dark:text-green-400 border border-green-400/30'
                : 'bg-yellow-400/10 text-amber-600 border border-yellow-400/30'
            )}
          >
            {result.hasAnalyticsData
              ? t('based_on_analytics', 'Based on your analytics data')
              : t('general_best_practices', 'Based on general best practices')}
          </div>
          <div className="text-[14px] leading-[22px] whitespace-pre-wrap bg-newBgColorInner p-[16px] rounded-[8px] border border-newTableBorder max-h-[500px] overflow-y-auto">
            {result.suggestion}
          </div>
          <div className="flex">
            <button
              onClick={() => {
                setResult(null);
                setError(null);
              }}
              className="cursor-pointer h-[36px] px-[16px] items-center justify-center border border-newTextColor/10 flex rounded-[6px] text-[12px]"
            >
              {t('check_again', 'Check Again')}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export const AiBestTime: FC = () => {
  const t = useT();
  const modals = useModals();

  const openModal = useCallback(() => {
    modals.openModal({
      title: t('best_time_to_post', 'Best Time to Post'),
      children: (close) => <AiBestTimeModal close={close} />,
    });
  }, [modals, t]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openModal}
        aria-label={t('best_times', 'Best Times')}
        className={clsx(
          'cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]'
        )}
      >
        <div className="flex gap-[5px] items-center">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="6.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M8 4.5V8L10.5 10"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M3.5 1.5L5 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
              <path
                d="M12.5 1.5L11 3"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-[10px] font-[600] iconBreak:hidden block">
            {t('best_times', 'Best Times')}
          </div>
        </div>
      </button>
    </div>
  );
};
