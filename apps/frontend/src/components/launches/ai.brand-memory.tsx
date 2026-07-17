'use client';

import { FC, useState, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useSWR, { mutate } from 'swr';

interface BrandMemoryHit {
  text: string;
  sourceType: string;
  sourceId: string;
  score: number;
}

export const BrandMemoryPanel: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const [prompt, setPrompt] = useState('');
  const [hits, setHits] = useState<BrandMemoryHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const [error, setError] = useState('');

  const handleIndex = useCallback(async () => {
    setIndexing(true);
    setError('');
    try {
      const res = await fetch('/ai/brand-memory/index', {
        method: 'POST',
      });
      const data = await res.json();
      if (data?.indexed !== undefined) {
        setIndexing(false);
      }
    } catch (err) {
      setError(t('brand_memory_index_error', 'Failed to index brand memory'));
    } finally {
      setIndexing(false);
    }
  }, [fetch, t]);

  const handleSearch = useCallback(async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/ai/brand-memory/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const data = await res.json();
      setHits(data?.hits || []);
    } catch (err) {
      setError(
        t('brand_memory_search_error', 'Failed to search brand memory'),
      );
    } finally {
      setLoading(false);
    }
  }, [prompt, fetch, t]);

  return (
    <div className="flex flex-col gap-[16px] p-[16px]">
      <div className="flex items-center justify-between">
        <h3 className="text-[16px] font-semibold">
          {t('brand_memory', 'Brand Memory')}
        </h3>
        <button
          onClick={handleIndex}
          disabled={indexing}
          className="px-[12px] py-[6px] bg-btnPrimary text-white rounded-[8px] text-[13px] font-medium disabled:opacity-50"
        >
          {indexing
            ? t('indexing', 'Indexing...')
            : t('index_top_posts', 'Index Top Posts')}
        </button>
      </div>
      <p className="text-[13px] text-newTableText">
        {t(
          'brand_memory_desc',
          'Index your top-performing posts so AI can write in your best style.',
        )}
      </p>
      <div className="flex gap-[8px]">
        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t(
            'brand_memory_placeholder',
            'Describe what you want to write...',
          )}
          className="flex-1 px-[12px] py-[8px] bg-newBgColor border border-newTableBorder rounded-[8px] text-[14px] outline-none"
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button
          onClick={handleSearch}
          disabled={loading || !prompt.trim()}
          className="px-[16px] py-[8px] bg-btnPrimary text-white rounded-[8px] text-[14px] font-medium disabled:opacity-50"
        >
          {loading
            ? t('searching', 'Searching...')
            : t('search', 'Search')}
        </button>
      </div>
      {error && (
        <div className="text-red-500 text-[13px]">{error}</div>
      )}
      {hits.length > 0 && (
        <div className="flex flex-col gap-[8px]">
          <h4 className="text-[14px] font-medium">
            {t('relevant_posts', 'Relevant Top-Performing Posts')}
          </h4>
          {hits.map((hit) => (
            <div
              key={hit.sourceId}
              className="p-[12px] bg-newBgColor border border-newTableBorder rounded-[8px]"
            >
              <p className="text-[13px] text-newTableText line-clamp-4">
                {hit.text}
              </p>
              <div className="flex items-center gap-[8px] mt-[8px]">
                <span className="text-[11px] text-newTableText">
                  {t('relevance', 'Relevance')}: {(hit.score * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
