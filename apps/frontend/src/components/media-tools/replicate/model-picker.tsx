'use client';

import React, { useCallback, useMemo } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useReplicateStore, ModelSummary } from './replicate.store';

interface ModelPickerProps {
  categoryKey: string;
}

function useModels(categoryKey: string) {
  const fetch = useFetch();
  return useSWR(categoryKey ? `replicate-models-${categoryKey}` : null, async () => {
    const res = await fetch(`/media/replicate/categories/${categoryKey}/models`);
    return (await res.json()) as ModelSummary[];
  });
}

function priceLabel(m: ModelSummary, t: (key: string, fallback: string) => string): string {
  if (m.pricing === 'output' && m.price) return `$${m.price.usd}`;
  return t('usage_billed', 'usage-billed');
}

// oc-platform-style model dropdown: name + warm/community grouping + price. The
// selected model's cover art is shown in the hero output "Example" pane, not here.
export function ModelPicker({ categoryKey }: ModelPickerProps) {
  const t = useT();
  const { data: models } = useModels(categoryKey);
  // Individual slice selectors — subscribing to the whole store re-runs effects on
  // every state change (the Maximum-update-depth loop we hit before). Actions are stable.
  const setModels = useReplicateStore((s) => s.setModels);
  const setSelectedModel = useReplicateStore((s) => s.setSelectedModel);
  const selectedModel = useReplicateStore((s) => s.selectedModel);
  const setError = useReplicateStore((s) => s.setError);
  const fetch = useFetch();

  React.useEffect(() => {
    if (models) setModels(models);
  }, [models, setModels]);

  const { warm, community } = useMemo(() => {
    const list = models || [];
    return {
      warm: list.filter((m) => m.warm),
      community: list.filter((m) => !m.warm),
    };
  }, [models]);

  const loadModel = useCallback(
    async (modelId: string) => {
      if (!modelId) {
        setSelectedModel(null);
        return;
      }
      const [owner, name] = modelId.split('/');
      try {
        const res = await fetch(`/media/replicate/models/${owner}/${name}`);
        const detail = await res.json();
        setSelectedModel(detail);
      } catch {
        setError(t('failed_to_load_model', 'Failed to load model'));
      }
    },
    [fetch, setSelectedModel, setError, t]
  );

  if (!models) {
    return <div className="h-10 rounded-lg bg-gray-800 animate-pulse" />;
  }

  return (
    <div>
      <label htmlFor="replicate-model" className="block text-xs uppercase tracking-wider text-newTextColor/70 mb-1.5">
        {t('model', 'Model')}
      </label>
      <select
        id="replicate-model"
        value={selectedModel?.id || ''}
        onChange={(e) => loadModel(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-studioBorder bg-newBgColorInner text-textColor text-sm focus:outline-none focus:border-designerAccent"
      >
        <option value="">{t('select_a_model', 'Select a model…')}</option>
        {warm.length > 0 && (
          <optgroup label={t('instant_official', 'Instant (official)')}>
            {warm.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {priceLabel(m, t)}
              </option>
            ))}
          </optgroup>
        )}
        {community.length > 0 && (
          <optgroup label={t('community_may_cold_start', 'Community (may cold-start)')}>
            {community.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {priceLabel(m, t)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}
