'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Slider } from '@gitroom/react/form/slider';
import { DataTable } from '@gitroom/frontend/components/ui/data-table';

interface RagStatus {
  enabled: boolean;
  indexedItems: number;
  lastIndexed: string | null;
  embeddingModel: string;
  vectorStore: string;
}

interface RagItem {
  sourceId: string;
  sourceType: string;
  indexedDate: string;
  chunkCount: number;
  charCount: number;
}

interface RagItemsResponse {
  items: RagItem[];
  total: number;
  offset: number;
  limit: number;
}

interface RagSearchHit {
  text: string;
  sourceType: string;
  sourceId: string;
  score: number;
}

const useRagStatus = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/rag/status');
    if (!res.ok) return { enabled: false, indexedItems: 0, lastIndexed: null, embeddingModel: '', vectorStore: 'pgvector' };
    return res.json();
  }, [fetch]);
  return useSWR<RagStatus>('rag-status', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
};

const useRagItems = (sourceType?: string, offset = 0, limit = 20) => {
  const fetch = useFetch();
  const paramsStr = React.useMemo(() => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(limit) });
    if (sourceType) params.set('sourceType', sourceType);
    return params.toString();
  }, [sourceType, offset, limit]);
  const load = useCallback(async () => {
    const res = await fetch(`/rag/items?${paramsStr}`);
    if (!res.ok) return { items: [], total: 0, offset, limit };
    return res.json();
  }, [fetch, paramsStr, offset, limit]);
  return useSWR<RagItemsResponse>(`rag-items-${paramsStr}`, load, {
    revalidateOnFocus: false,
  });
};

export const KnowledgeBase = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data: status, isLoading: statusLoading, mutate: mutateStatus } = useRagStatus();
  const [itemsPage, setItemsPage] = useState(0);
  const { data: itemsData, isLoading: itemsLoading, mutate: mutateItems } = useRagItems(undefined, itemsPage * 20, 20);

  const [showAddContent, setShowAddContent] = useState(false);
  const [addSourceType, setAddSourceType] = useState<'text' | 'url' | 'file'>('text');
  const [addContent, setAddContent] = useState('');
  const [adding, setAdding] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RagSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [backfilling, setBackfilling] = useState(false);

  const [vectorStore, setVectorStore] = useState('pgvector');
  const [qdrantUrl, setQdrantUrl] = useState('');
  const [qdrantApiKey, setQdrantApiKey] = useState('');
  const [qdrantCollection, setQdrantCollection] = useState('postmill_rag');
  const [distance, setDistance] = useState('Cosine');
  // Remote pgvector
  const [pgUrl, setPgUrl] = useState('');
  const [pgTable, setPgTable] = useState('postmill_rag');
  const [pgConfigured, setPgConfigured] = useState(false);
  // Pinecone
  const [pineconeApiKey, setPineconeApiKey] = useState('');
  const [pineconeIndex, setPineconeIndex] = useState('');
  const [pineconeHost, setPineconeHost] = useState('');
  const [pineconeConfigured, setPineconeConfigured] = useState(false);
  const [qdrantConfigured, setQdrantConfigured] = useState(false);
  const [embeddingDimension, setEmbeddingDimension] = useState(1536);
  const [chunkStrategy, setChunkStrategy] = useState('fixed-size');
  const [chunkSize, setChunkSize] = useState(500);
  const [chunkOverlap, setChunkOverlap] = useState(100);
  const [fusionStrategy, setFusionStrategy] = useState('rrf');
  const [rrfK, setRrfK] = useState(60);
  const [vectorWeight, setVectorWeight] = useState(0.5);
  const [bm25Weight, setBm25Weight] = useState(0.5);
  const [bm25K1, setBm25K1] = useState(1.2);
  const [bm25B, setBm25B] = useState(0.75);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // Tucks the technical cards (Vector Database, Auto-Index) away from beginners.
  const [kbAdvancedOpen, setKbAdvancedOpen] = useState(false);
  const [autoIndex, setAutoIndex] = useState(false);
  const [autoIndexSources, setAutoIndexSources] = useState<string[]>([]);
  const [newAutoIndexSource, setNewAutoIndexSource] = useState('');
  const [vecSaving, setVecSaving] = useState(false);
  const [vecTesting, setVecTesting] = useState(false);
  const [vecTestResult, setVecTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const loadVecSettings = useCallback(async () => {
    const res = await fetch('/rag/settings');
    if (!res.ok) return;
    const data = await res.json();
    setVectorStore(data.vectorStore || 'pgvector');
    setQdrantUrl(data.qdrantUrl || '');
    setQdrantCollection(data.qdrantCollection || 'postmill_rag');
    setDistance(data.distance || 'Cosine');
    setQdrantConfigured(!!data.qdrantConfigured);
    setPgTable(data.pgTable || 'postmill_rag');
    setPgConfigured(!!data.pgConfigured);
    setPineconeIndex(data.pineconeIndex || '');
    setPineconeHost(data.pineconeHost || '');
    setPineconeConfigured(!!data.pineconeConfigured);
    setEmbeddingDimension(data.embeddingDimension || 1536);
    setChunkStrategy(data.chunkStrategy || 'fixed-size');
    setChunkSize(data.chunkSize || 500);
    setChunkOverlap(data.chunkOverlap || 100);
    setFusionStrategy(data.fusionStrategy || 'rrf');
    setRrfK(data.rrfK || 60);
    setVectorWeight(data.vectorWeight ?? 0.5);
    setBm25Weight(data.bm25Weight ?? 0.5);
    setBm25K1(data.bm25K1 ?? 1.2);
    setBm25B(data.bm25B ?? 0.75);
    setAutoIndex(!!data.autoIndex);
    setAutoIndexSources(Array.isArray(data.autoIndexSources) ? data.autoIndexSources : []);
  }, [fetch]);
  useEffect(() => { loadVecSettings(); }, [loadVecSettings]);
  const handleSaveVecSettings = useCallback(async () => {
    setVecSaving(true);
    try {
      const res = await fetch('/rag/settings', {
        method: 'PUT',
        body: JSON.stringify({
          vectorStore,
          qdrantUrl: vectorStore === 'qdrant' ? qdrantUrl : undefined,
          qdrantApiKey: vectorStore === 'qdrant' && qdrantApiKey ? qdrantApiKey : undefined,
          qdrantCollection: vectorStore === 'qdrant' ? qdrantCollection : undefined,
          distance: vectorStore === 'qdrant' ? distance : undefined,
          pgUrl: vectorStore === 'pgvector-remote' && pgUrl ? pgUrl : undefined,
          pgTable: vectorStore === 'pgvector-remote' ? pgTable : undefined,
          pineconeApiKey: vectorStore === 'pinecone' && pineconeApiKey ? pineconeApiKey : undefined,
          pineconeIndex: vectorStore === 'pinecone' ? pineconeIndex : undefined,
          pineconeHost: vectorStore === 'pinecone' ? pineconeHost : undefined,
          embeddingDimension,
          chunkStrategy,
          chunkSize,
          chunkOverlap,
          fusionStrategy,
          rrfK: fusionStrategy === 'rrf' ? rrfK : undefined,
          vectorWeight: fusionStrategy === 'weighted-sum' ? vectorWeight : undefined,
          bm25Weight: fusionStrategy === 'weighted-sum' ? bm25Weight : undefined,
      bm25K1,
      bm25B,
      autoIndex,
      autoIndexSources,
    }),
      });
      if (!res.ok) {
        toaster.show(t('failed_to_save_vector_store_settings', 'Failed to save vector store settings'), 'warning');
        return;
      }
      toaster.show(t('vec_settings_saved', 'Vector store settings saved'), 'success');
      mutateStatus();
    } catch {
      toaster.show(t('failed_to_save_vector_store_settings', 'Failed to save vector store settings'), 'warning');
    } finally {
      setVecSaving(false);
    }
  }, [fetch, vectorStore, qdrantUrl, qdrantApiKey, qdrantCollection, distance, pgUrl, pgTable, pineconeApiKey, pineconeIndex, pineconeHost, embeddingDimension, chunkStrategy, chunkSize, chunkOverlap, fusionStrategy, rrfK, vectorWeight, bm25Weight, bm25K1, bm25B, autoIndex, autoIndexSources, toaster, t, mutateStatus]);
  const handleTestConnection = useCallback(async () => {
    setVecTesting(true);
    setVecTestResult(null);
    try {
      const res = await fetch('/rag/settings/test-connection', {
        method: 'POST',
        body: JSON.stringify({
          vectorStore,
          qdrantUrl: vectorStore === 'qdrant' ? qdrantUrl : undefined,
          qdrantApiKey: vectorStore === 'qdrant' && qdrantApiKey ? qdrantApiKey : undefined,
          qdrantCollection: vectorStore === 'qdrant' ? qdrantCollection : undefined,
          distance: vectorStore === 'qdrant' ? distance : undefined,
          pgUrl: vectorStore === 'pgvector-remote' && pgUrl ? pgUrl : undefined,
          pgTable: vectorStore === 'pgvector-remote' ? pgTable : undefined,
          pineconeApiKey: vectorStore === 'pinecone' && pineconeApiKey ? pineconeApiKey : undefined,
          pineconeIndex: vectorStore === 'pinecone' ? pineconeIndex : undefined,
          pineconeHost: vectorStore === 'pinecone' ? pineconeHost : undefined,
          embeddingDimension,
        }),
      });
      const data = await res.json();
      setVecTestResult(data);
    } catch {
      setVecTestResult({ ok: false, error: t('connection_test_failed', 'Connection test failed') });
    } finally {
      setVecTesting(false);
    }
  }, [fetch, vectorStore, qdrantUrl, qdrantApiKey, qdrantCollection, distance, pgUrl, pgTable, pineconeApiKey, pineconeIndex, pineconeHost, embeddingDimension]);

  const handleAddContent = useCallback(async () => {
    if (!addContent.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/rag/index', {
        method: 'POST',
        body: JSON.stringify({
          sourceType: addSourceType,
          content: addContent.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        toaster.show(err.message || t('failed_to_index_content', 'Failed to index content'), 'warning');
        return;
      }
      toaster.show(t('content_indexed', 'Content indexed successfully'), 'success');
      setShowAddContent(false);
      setAddContent('');
      mutateStatus();
      mutateItems();
    } catch {
      toaster.show(t('failed_to_index_content', 'Failed to index content'), 'warning');
    } finally {
      setAdding(false);
    }
  }, [addContent, addSourceType, fetch, toaster, t, mutateStatus, mutateItems]);

  const handleDelete = useCallback(async (sourceType: string, sourceId: string) => {
    try {
      const res = await fetch(`/rag/items/${encodeURIComponent(sourceType)}/${encodeURIComponent(sourceId)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toaster.show(t('failed_to_delete_item', 'Failed to delete item'), 'warning');
        return;
      }
      toaster.show(t('item_deleted', 'Item deleted'), 'success');
      mutateStatus();
      mutateItems();
    } catch {
      toaster.show(t('failed_to_delete_item', 'Failed to delete item'), 'warning');
    }
  }, [fetch, toaster, t, mutateStatus, mutateItems]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults(null);
    try {
      const res = await fetch('/rag/search', {
        method: 'POST',
        body: JSON.stringify({ query: searchQuery.trim(), limit: 10 }),
      });
      if (!res.ok) {
        toaster.show(t('search_failed', 'Search failed'), 'warning');
        return;
      }
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch {
      toaster.show(t('search_failed', 'Search failed'), 'warning');
    } finally {
      setSearching(false);
    }
  }, [searchQuery, fetch, toaster]);

  const handleBackfill = useCallback(async () => {
    setBackfilling(true);
    try {
      const res = await fetch('/rag/backfill', {
        method: 'POST',
      });
      if (!res.ok) {
        toaster.show(t('backfill_failed', 'Backfill failed'), 'warning');
        return;
      }
      const data = await res.json();
      toaster.show(
        t('backfill_completed', 'Backfill completed — indexed {{count}} new sources', {
          count: data.indexed || 0,
        }),
        'success',
      );
      mutateStatus();
      mutateItems();
    } catch {
      toaster.show(t('backfill_failed', 'Backfill failed'), 'warning');
    } finally {
      setBackfilling(false);
    }
  }, [fetch, toaster, t, mutateStatus, mutateItems]);

  if (statusLoading) {
    return (
      <div className="my-[16px] bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px]">
        <div className="animate-pulse">{t('loading', 'Loading')}</div>
      </div>
    );
  }

  const sourceTypeLabels: Record<string, string> = {
    text: t('text', 'Text'),
    url: t('url', 'URL'),
    file: t('file', 'File'),
    post: t('post', 'Post'),
    media: t('media', 'Media'),
    brand_memory: t('brand_memory', 'Brand Memory'),
  };

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[24px]">
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <div className="text-[14px]">{t('knowledge_base', 'What the AI knows about you')}</div>
            <div className="text-[12px] text-newTableText max-w-[560px] leading-relaxed">
              {t('knowledge_base_description_v2', "Give the AI examples and facts about your business — your best posts, web pages, or notes. It'll use them to sound more like you and get the details right. Nothing here is required to start.")}
            </div>
          </div>
          <button
            className="bg-btnPrimary text-white rounded-[8px] px-[12px] py-[6px] text-[13px] hover:opacity-90 disabled:opacity-50 shrink-0"
            onClick={handleBackfill}
            disabled={backfilling}
            title={t('backfill_tip', 'Learn from your best-performing past posts automatically')}
          >
            {backfilling ? t('indexing', 'Learning...') : t('backfill', 'Learn from my posts')}
          </button>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-[16px]">
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[4px]">
            <span className="text-[11px] text-newTableText uppercase tracking-wider">
              {t('status', 'Status:')}
            </span>
            <span className="text-[14px] font-semibold">
              {status?.enabled ? (
                <span className="text-green-500">{t('enabled', 'Enabled')}</span>
              ) : (
                <span className="text-newTableText">{t('disabled', 'Disabled')}</span>
              )}
            </span>
          </div>
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[4px]">
            <span className="text-[11px] text-newTableText uppercase tracking-wider">
              {t('indexed_items', 'Indexed Items')}
            </span>
            <span className="text-[14px] font-semibold">{status?.indexedItems || 0}</span>
          </div>
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[4px]">
            <span className="text-[11px] text-newTableText uppercase tracking-wider">
              {t('last_indexed', 'Last Indexed')}
            </span>
            <span className="text-[14px] font-semibold">
              {status?.lastIndexed
                ? new Date(status.lastIndexed).toLocaleDateString()
                : t('never', 'Never')}
            </span>
          </div>
          <div className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px] flex flex-col gap-[4px]">
            <span className="text-[11px] text-newTableText uppercase tracking-wider">
              {t('embedding_model', 'Embedding Model')}
            </span>
            <span className="text-[14px] font-semibold break-all">
              {status?.embeddingModel || '—'}
            </span>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setKbAdvancedOpen((v) => !v)}
        className="text-[12px] text-newTableText hover:text-textColor self-start"
      >
        {kbAdvancedOpen
          ? t('hide_kb_advanced', '▾ Hide advanced settings')
          : t('show_kb_advanced', '▸ Advanced settings (most people can skip these)')}
      </button>

      {kbAdvancedOpen && (
        <>
      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[14px]">{t('vector_store', 'Vector Database')}</div>
        <div className="text-[12px] text-newTableText">
          {t('vector_store_description_v2', "Where your knowledge is stored. The default (Postmill) works for everyone — only change this if your team runs its own database.")}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-[16px]">
          <div className="flex flex-col gap-[4px]">
            <label className="text-[12px] text-newTableText">{t('adapter_type', 'Vector database')}</label>
            <select
              value={vectorStore}
              onChange={(e) => setVectorStore(e.target.value)}
              className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
            >
              <option value="pgvector">{t('vs_postmill_default', 'Postmill (Default)')}</option>
              <option value="pgvector-remote">{t('vs_pgvector_remote', 'PG Vector (Remote)')}</option>
              <option value="qdrant">{t('vs_qdrant_remote', 'Qdrant (Remote)')}</option>
              <option value="pinecone">{t('vs_pinecone_remote', 'Pinecone (Remote)')}</option>
            </select>
          </div>

          {vectorStore === 'pgvector-remote' && (
            <>
              <div className="flex flex-col gap-[4px] md:col-span-2">
                <label className="text-[12px] text-newTableText">{t('pg_connection_string', 'Connection string')}</label>
                <input
                  type="password"
                  autoComplete="off"
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={pgUrl}
                  onChange={(e) => setPgUrl(e.target.value)}
                  placeholder={pgConfigured ? t('configured_leave_blank', '•••• configured — leave blank to keep') : t('pg_url_placeholder', 'postgres://user:pass@host:5432/db')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('pg_table', 'Table')}</label>
                <input
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={pgTable}
                  onChange={(e) => setPgTable(e.target.value)}
                  placeholder={t('rag_table_placeholder', 'postmill_rag')}
                />
              </div>
            </>
          )}

          {vectorStore === 'qdrant' && (
            <>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('qdrant_url', 'URL')}</label>
                <input
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={qdrantUrl}
                  onChange={(e) => setQdrantUrl(e.target.value)}
                  placeholder={t('qdrant_url_placeholder', 'https://your-cluster.qdrant.io:6333')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('qdrant_api_key', 'API Key')}</label>
                <input
                  type="password"
                  autoComplete="off"
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={qdrantApiKey}
                  onChange={(e) => setQdrantApiKey(e.target.value)}
                  placeholder={qdrantConfigured ? t('configured_leave_blank', '•••• configured — leave blank to keep') : t('optional', '(optional)')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('qdrant_collection', 'Collection')}</label>
                <input
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={qdrantCollection}
                  onChange={(e) => setQdrantCollection(e.target.value)}
                  placeholder={t('rag_table_placeholder', 'postmill_rag')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('distance', 'Distance')}</label>
                <select
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                >
                  <option value="Cosine">{t('distance_cosine', 'Cosine')}</option>
                  <option value="Euclid">{t('distance_euclidean', 'Euclidean')}</option>
                  <option value="Dot">{t('distance_dot_product', 'Dot Product')}</option>
                </select>
              </div>
            </>
          )}

          {vectorStore === 'pinecone' && (
            <>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('pinecone_api_key', 'API Key')}</label>
                <input
                  type="password"
                  autoComplete="off"
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={pineconeApiKey}
                  onChange={(e) => setPineconeApiKey(e.target.value)}
                  placeholder={pineconeConfigured ? t('configured_leave_blank', '•••• configured — leave blank to keep') : t('pinecone_api_key_placeholder', 'pcsk_...')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('pinecone_index', 'Index')}</label>
                <input
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={pineconeIndex}
                  onChange={(e) => setPineconeIndex(e.target.value)}
                  placeholder={t('pinecone_index_placeholder', 'postmill-rag')}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('pinecone_host', 'Host')} <span className="text-[10px]">{t('optional', '(optional)')}</span></label>
                <input
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={pineconeHost}
                  onChange={(e) => setPineconeHost(e.target.value)}
                  placeholder={t('pinecone_host_placeholder', 'idx-xxxx.svc.region.pinecone.io')}
                />
              </div>
            </>
          )}

          {vectorStore !== 'pgvector' && (
            <div className="flex flex-col gap-[4px]">
              <label className="text-[12px] text-newTableText">{t('embedding_dimension', 'Embedding Dimension')}</label>
              <input
                type="number"
                min={128}
                max={4096}
                className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                value={embeddingDimension}
                onChange={(e) => setEmbeddingDimension(parseInt(e.target.value, 10) || 1536)}
              />
            </div>
          )}
        </div>

        {vectorStore !== 'pgvector' && (
          <button
            className="text-[12px] text-textColor hover:underline self-start"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? t('hide_advanced', 'Hide advanced settings') : t('show_advanced', 'Show advanced settings')}
          </button>
        )}

        {vectorStore !== 'pgvector' && showAdvanced && (
          <div className="flex flex-col gap-[16px]">
            <div className="text-[13px] font-medium">{t('chunking', 'Chunking')}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('chunk_strategy', 'Strategy')}</label>
                <select
                  value={chunkStrategy}
                  onChange={(e) => setChunkStrategy(e.target.value)}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                >
                  <option value="fixed-size">{t('chunk_strategy_fixed_size', 'Fixed Size')}</option>
                  <option value="semantic">{t('chunk_strategy_semantic', 'Semantic')}</option>
                  <option value="recursive">{t('chunk_strategy_recursive', 'Recursive')}</option>
                  <option value="sliding-window">{t('chunk_strategy_sliding_window', 'Sliding Window')}</option>
                </select>
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('chunk_size', 'Chunk Size')}</label>
                <input
                  type="number"
                  min={100}
                  max={2000}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(parseInt(e.target.value, 10) || 500)}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('chunk_overlap', 'Overlap')}</label>
                <input
                  type="number"
                  min={0}
                  max={500}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={chunkOverlap}
                  onChange={(e) => setChunkOverlap(parseInt(e.target.value, 10) || 100)}
                />
              </div>
            </div>

            <div className="text-[13px] font-medium">{t('fusion', 'Fusion')}</div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[16px]">
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('fusion_strategy', 'Strategy')}</label>
                <select
                  value={fusionStrategy}
                  onChange={(e) => setFusionStrategy(e.target.value)}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                >
                  <option value="rrf">{t('fusion_strategy_rrf', 'Reciprocal Rank Fusion (RRF)')}</option>
                  <option value="weighted-sum">{t('fusion_strategy_weighted_sum', 'Weighted Sum')}</option>
                  <option value="normalized">{t('fusion_strategy_normalized', 'Normalized Score')}</option>
                </select>
              </div>
              {fusionStrategy === 'rrf' && (
                <div className="flex flex-col gap-[4px]">
                  <label className="text-[12px] text-newTableText">{t('rrf_k', 'RRF K')}</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                    value={rrfK}
                    onChange={(e) => setRrfK(parseInt(e.target.value, 10) || 60)}
                  />
                </div>
              )}
              {fusionStrategy === 'weighted-sum' && (
                <>
                  <div className="flex flex-col gap-[4px]">
                    <label className="text-[12px] text-newTableText">{t('vector_weight', 'Vector Weight')}</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                      value={vectorWeight}
                      onChange={(e) => setVectorWeight(parseFloat(e.target.value) || 0.5)}
                    />
                  </div>
                  <div className="flex flex-col gap-[4px]">
                    <label className="text-[12px] text-newTableText">{t('bm25_weight', 'BM25 Weight')}</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                      value={bm25Weight}
                      onChange={(e) => setBm25Weight(parseFloat(e.target.value) || 0.5)}
                    />
                  </div>
                </>
              )}
            </div>

            <div className="text-[13px] font-medium">{t('bm25', 'BM25')}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-[16px]">
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('bm25_k1', 'k1')}</label>
                <input
                  type="number"
                  min={0}
                  max={5}
                  step={0.05}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={bm25K1}
                  onChange={(e) => setBm25K1(parseFloat(e.target.value) || 1.2)}
                />
              </div>
              <div className="flex flex-col gap-[4px]">
                <label className="text-[12px] text-newTableText">{t('bm25_b', 'b')}</label>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                  value={bm25B}
                  onChange={(e) => setBm25B(parseFloat(e.target.value) || 0.75)}
                />
              </div>
            </div>
          </div>
        )}

        {vectorStore !== 'pgvector' && vecTestResult && (
          <div className={`text-[12px] ${vecTestResult.ok ? 'text-green-500' : 'text-red-500'}`}>
            {vecTestResult.ok ? t('connection_ok', 'Connection successful') : (vecTestResult.error || t('connection_failed', 'Connection failed'))}
          </div>
        )}
        <div className="flex gap-[8px]">
          {vectorStore !== 'pgvector' && (
            <button
              className="bg-newBgColorInner border border-newTableBorder text-textColor rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90 disabled:opacity-50"
              onClick={handleTestConnection}
              disabled={vecTesting}
            >
              {vecTesting ? t('testing', 'Testing...') : t('test_connection', 'Test Connection')}
            </button>
          )}
          <button
            className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90 disabled:opacity-50"
            onClick={handleSaveVecSettings}
            disabled={vecSaving}
          >
            {vecSaving ? t('saving', 'Saving...') : t('save', 'Save')}
          </button>
        </div>
      </div>

      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[14px] font-medium">{t('auto_index', 'Auto-Index')}</div>
        <p className="text-[12px] text-newTableText">
          {t('auto_index_description', 'Enable automatic indexing of content from specified URL patterns during crawl/sync operations.')}
        </p>
        <div className="flex items-center gap-[12px]">
          <Slider value={autoIndex ? 'on' : 'off'} onChange={(val) => setAutoIndex(val === 'on')} />
          <span className="text-[13px]">
            {autoIndex ? t('auto_index_enabled', 'Enabled') : t('auto_index_disabled', 'Disabled')}
          </span>
        </div>
        {autoIndex && (
          <div className="flex flex-col gap-[8px]">
            <div className="text-[13px]">{t('auto_index_sources', 'URL Patterns')}</div>
            <div className="flex gap-[8px]">
              <input
                type="text"
                className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] flex-1"
                placeholder={t('auto_index_source_placeholder', 'e.g. https://example.com/blog/*')}
                value={newAutoIndexSource}
                onChange={(e) => setNewAutoIndexSource(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && newAutoIndexSource.trim()) {
                    setAutoIndexSources([...autoIndexSources, newAutoIndexSource.trim()]);
                    setNewAutoIndexSource('');
                  }
                }}
              />
              <button
                className="bg-btnPrimary text-white rounded-[8px] px-[12px] py-[8px] text-[13px] hover:opacity-90"
                onClick={() => {
                  if (newAutoIndexSource.trim()) {
                    setAutoIndexSources([...autoIndexSources, newAutoIndexSource.trim()]);
                    setNewAutoIndexSource('');
                  }
                }}
              >
                {t('add', 'Add')}
              </button>
            </div>
            {autoIndexSources.length > 0 && (
              <div className="flex flex-col gap-[4px]">
                {autoIndexSources.map((src) => (
                  <div key={src} className="flex items-center justify-between bg-newBgColorInner rounded-[8px] px-[12px] py-[6px] text-[13px]">
                    <code className="text-textColor">{src}</code>
                    <button
                      className="text-red-600 dark:text-red-500 hover:underline ml-[8px] text-[12px]"
                      onClick={() => setAutoIndexSources(autoIndexSources.filter((s) => s !== src))}
                    >
                      {t('remove', 'Remove')}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
        </>
      )}

      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="flex items-center justify-between">
          <div className="text-[14px]">{t('add_content', 'Teach the AI something')}</div>
          <button
            className="text-[13px] text-textColor hover:underline"
            onClick={() => setShowAddContent(!showAddContent)}
          >
            {showAddContent ? t('cancel', 'Cancel') : t('add_content_button', '+ Add Content')}
          </button>
        </div>

        {showAddContent && (
          <div className="flex flex-col gap-[12px] bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[16px]">
            <div className="flex gap-[8px]">
              <button
                className={`px-[12px] py-[6px] text-[13px] rounded-[8px] border ${
                  addSourceType === 'text'
                    ? 'bg-btnPrimary text-white border-btnPrimary'
                    : 'border-newTableBorder hover:bg-boxHover'
                }`}
                onClick={() => setAddSourceType('text')}
              >
                {t('text', 'Text')}
              </button>
              <button
                className={`px-[12px] py-[6px] text-[13px] rounded-[8px] border ${
                  addSourceType === 'url'
                    ? 'bg-btnPrimary text-white border-btnPrimary'
                    : 'border-newTableBorder hover:bg-boxHover'
                }`}
                onClick={() => setAddSourceType('url')}
              >
                {t('url', 'URL')}
              </button>
              <button
                className={`px-[12px] py-[6px] text-[13px] rounded-[8px] border ${
                  addSourceType === 'file'
                    ? 'bg-btnPrimary text-white border-btnPrimary'
                    : 'border-newTableBorder hover:bg-boxHover'
                }`}
                onClick={() => setAddSourceType('file')}
              >
                {t('file', 'File')}
              </button>
            </div>

            {addSourceType === 'url' && (
              <input
                className="bg-newBgColor border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
                placeholder={t('url_placeholder', 'Enter URL to index...')}
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
              />
            )}

            {addSourceType === 'text' && (
              <textarea
                className="bg-newBgColor border border-newTableBorder rounded-[8px] min-h-[100px] p-[8px] text-textColor text-[13px] resize-y"
                placeholder={t('text_placeholder', 'Paste or type content to index...')}
                value={addContent}
                onChange={(e) => setAddContent(e.target.value)}
              />
            )}

            {addSourceType === 'file' && (
              <div className="flex flex-col gap-[8px]">
                <input
                  type="file"
                  accept=".txt,.pdf,.md,.csv"
                  className="bg-newBgColor border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] file:mr-[12px] file:bg-btnPrimary file:text-white file:border-0 file:rounded-[4px] file:px-[12px] file:py-[6px] file:text-[13px] file:cursor-pointer cursor-pointer"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      setAddContent(ev.target?.result as string || '');
                    };
                    reader.readAsText(file);
                  }}
                />
                {addContent && (
                  <div className="text-[12px] text-newTableText">
                    {t('file_loaded', 'File loaded:')} {addContent.length} {t('chars', 'chars')}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90 disabled:opacity-50"
                onClick={handleAddContent}
                disabled={adding || !addContent.trim()}
              >
                {adding ? t('indexing', 'Indexing...') : t('index', 'Index')}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[16px]">
        <div className="text-[14px]">{t('indexed_content', "What you've added")}</div>

        <DataTable
          columns={[
            { key: 'source', header: t('source', 'Source'), render: (item: RagItem) => (
              <span className="max-w-[200px] truncate block">{item.sourceId}</span>
            )},
            { key: 'type', header: t('type', 'Type'), render: (item: RagItem) => (
              <span className="bg-newTableHeader rounded-[4px] px-[6px] py-[2px] text-[11px]">
                {sourceTypeLabels[item.sourceType] || item.sourceType}
              </span>
            )},
            { key: 'chunks', header: t('chunks', 'Chunks'), render: (item: RagItem) => item.chunkCount },
            { key: 'chars', header: t('chars', 'Chars'), render: (item: RagItem) => item.charCount.toLocaleString() },
            { key: 'indexedDate', header: t('indexed_date', 'Indexed Date'), render: (item: RagItem) => (
              <span className="text-newTableText">{new Date(item.indexedDate).toLocaleDateString()}</span>
            )},
            { key: 'actions', header: t('actions', 'Actions'), align: 'right', render: (item: RagItem) => (
              <button className="text-[12px] text-red-600 dark:text-red-500 hover:underline" onClick={() => handleDelete(item.sourceType, item.sourceId)}>
                {t('delete', 'Delete')}
              </button>
            )},
          ]}
          data={itemsData?.items || []}
          keyExtractor={(item: RagItem) => `${item.sourceType}:${item.sourceId}`}
          loading={itemsLoading}
          page={itemsPage + 1}
          total={itemsData?.total || 0}
          limit={20}
          onPageChange={(p) => setItemsPage(p - 1)}
          emptyState={{ title: t('no_indexed_content', 'No indexed content yet') }}
        />
      </div>

      <div className="bg-newBgColorInner border-newTableBorder border rounded-[12px] p-[24px] flex flex-col gap-[16px]">
        <div className="text-[14px]">{t('search_knowledge_base', 'Try a search')}</div>
        <div className="text-[12px] text-newTableText">
          {t('search_knowledge_base_hint', 'See what the AI finds for a topic — a quick way to check it learned the right things.')}
        </div>
        <div className="flex gap-[8px]">
          <input
            className="flex-1 bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
            placeholder={t('search_placeholder', 'Search what the AI knows…')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
          />
          <button
            className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90 disabled:opacity-50"
            onClick={handleSearch}
            disabled={searching || !searchQuery.trim()}
          >
            {searching ? t('searching', 'Searching...') : t('search', 'Search')}
          </button>
        </div>

        {searchResults !== null && (
          <div className="flex flex-col gap-[8px]">
            {searchResults.length === 0 ? (
              <div className="text-[13px] text-newTableText">
                {t('no_results', 'No results found')}
              </div>
            ) : (
              searchResults.map((hit, i) => (
                <div
                  key={`${hit.sourceType}:${hit.sourceId}:${hit.text?.slice(0, 40) ?? ''}`}
                  className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[12px] flex flex-col gap-[4px]"
                >
                  <div className="flex items-center gap-[8px]">
                    <span className="bg-newTableHeader rounded-[4px] px-[6px] py-[2px] text-[11px]">
                      {sourceTypeLabels[hit.sourceType] || hit.sourceType}
                    </span>
                    <span className="text-[11px] text-newTableText">
                      {t('relevance', 'Relevance')}: {(hit.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-[12px] text-textColor line-clamp-3">{hit.text}</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
