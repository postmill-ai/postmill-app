'use client';

import { FC, useCallback, useState } from 'react';
import clsx from 'clsx';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useDebounce } from 'use-debounce';

const AiSearchModal: FC<{ close: () => void }> = (props) => {
  const { close } = props;
  const t = useT();
  const fetch = useFetch();
  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebounce(query, 300);

  const { data, isLoading, error } = useSWR(
    debouncedQuery
      ? `/ai/search?query=${encodeURIComponent(debouncedQuery)}&limit=10`
      : null,
    async (url) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(t('search_unavailable', 'Search unavailable'));
      }
      return res.json();
    },
  );

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="relative">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          className="absolute left-[12px] top-[50%] -translate-y-[50%] text-newTextColor/60"
        >
          <circle
            cx="7"
            cy="7"
            r="5.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path
            d="M11 11L14.5 14.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(
            'search_past_content',
            'Search past content semantically...'
          )}
          className="bg-input w-full pl-[36px] pr-[12px] h-[42px] outline-none border-newTableBorder border rounded-[6px] text-inputText placeholder-inputText text-[14px]"
        />
      </div>

      {isLoading && (
        <div className="flex justify-center py-[32px]">
          <Loading height={24} width={24} type="spin" color="#2b5cd3" />
        </div>
      )}

      {error && !isLoading && (
        <div className="text-[12px] text-amber-600 p-[12px] bg-yellow-400/10 rounded-[6px] border border-yellow-400/30">
          {t(
            'semantic_search_unavailable',
            'Semantic search is not available. The RAG pipeline may not be configured.'
          )}
        </div>
      )}

      {!isLoading && !error && debouncedQuery && (!data || data.length === 0) && (
        <div className="text-[13px] text-newTextColor/65 py-[32px] text-center">
          {t('no_results_found', 'No results found')}
        </div>
      )}

      {!isLoading && data && data.length > 0 && (
        <div className="flex flex-col gap-[8px] max-h-[500px] overflow-y-auto">
          {data.map((item: any) => (
            <div
              key={
                item.id ??
                `${item.source || 'search'}-${(item.content || item.text || item.snippet || '').slice(0, 40)}`
              }
              className="bg-newBgColorInner p-[12px] rounded-[8px] border border-newTableBorder"
            >
              <div className="text-[13px] leading-[20px] whitespace-pre-wrap mb-[8px]">
                {item.content || item.text || item.snippet || JSON.stringify(item)}
              </div>
              {item.source && (
                <div className="text-[11px] text-newTextColor/65">
                  {t('source', 'Source')}: {item.source}
                </div>
              )}
              {item.score !== undefined && (
                <div className="text-[10px] text-newTextColor/60 mt-[2px]">
                  {t('relevance', 'Relevance')}:{' '}
                  {typeof item.score === 'number'
                    ? `${(item.score * 100).toFixed(0)}%`
                    : item.score}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const AiSearch: FC = () => {
  const t = useT();
  const modals = useModals();

  const openModal = useCallback(() => {
    modals.openModal({
      title: t('semantic_search', 'Semantic Search'),
      children: (close) => <AiSearchModal close={close} />,
    });
  }, [modals, t]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={openModal}
        aria-label={t('ai_search', 'AI Search')}
        className={clsx(
          'm-0 p-0 border-0 bg-transparent cursor-pointer h-[30px] rounded-[6px] justify-center items-center flex bg-newColColor px-[8px]'
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
                cx="7"
                cy="7"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.2"
              />
              <path
                d="M11 11L14.5 14.5"
                stroke="currentColor"
                strokeWidth="1.2"
                strokeLinecap="round"
              />
            </svg>
          </div>
          <div className="text-[10px] font-[600] iconBreak:hidden block">
            {t('ai_search', 'AI Search')}
          </div>
        </div>
      </button>
    </div>
  );
};
