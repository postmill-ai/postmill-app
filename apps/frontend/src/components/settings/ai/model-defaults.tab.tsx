'use client';

import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import {
  AI_MODEL_CATEGORIES,
  type AiModelCategory,
} from '@gitroom/nestjs-libraries/ai/defaults/default-categories';
import {
  DefaultModelSelect,
  useDefaultCatalog,
} from '@gitroom/frontend/components/settings/shared/default-model-select';
import { useToaster } from '@gitroom/react/toaster/toaster';

interface ModelDefaultRow {
  category: AiModelCategory;
  providerId?: string;
  version?: string;
  model?: string;
  settings?: Record<string, unknown>;
  source: 'stored' | 'auto' | null;
}

interface ModelDefaultsResponse {
  categories: ModelDefaultRow[];
}

const CATEGORY_LABELS: Record<AiModelCategory, [string, string]> = {
  'low-reasoning': ['ai_category_low_reasoning', 'Low Reasoning'],
  'high-reasoning': ['ai_category_high_reasoning', 'High Reasoning'],
  vision: ['ai_category_vision', 'Vision'],
  workflow: ['ai_category_workflow', 'Workflow'],
};

const CATEGORY_HELP: Record<AiModelCategory, [string, string]> = {
  'low-reasoning': [
    'ai_category_help_low_reasoning',
    'Used for utility text, prompts, slide breakdowns, and embeddings.',
  ],
  'high-reasoning': [
    'ai_category_help_high_reasoning',
    'Used for generation, agents, MCP, and any reasoning-heavy task.',
  ],
  vision: [
    'ai_category_help_vision',
    'Used for image understanding and focal-point detection.',
  ],
  workflow: [
    'ai_category_help_workflow',
    'Reserved for future agentic workflow steps.',
  ],
};

const useModelDefaults = () => {
  const fetch = useFetch();
  const load = useCallback(
    async () => (await fetch('/settings/ai/defaults')).json() as Promise<ModelDefaultsResponse>,
    [fetch]
  );
  return useSWR('/settings/ai/defaults', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

// One row = one catalog hook (rules-of-hooks: hooks can't live inside the parent's
// `.map`). The row owns availability: when the org has no provider that can serve this
// category the catalog is empty → the field is DISABLED with an honest message. There is
// no "Auto picks a model" pretence when there is nothing to pick.
const AiDefaultRow: React.FC<{
  row: ModelDefaultRow;
  saving: boolean;
  onSave: (
    category: AiModelCategory,
    value: { providerId: string; version: string; model?: string } | null
  ) => void;
}> = ({ row, saving, onSave }) => {
  const t = useT();
  const { data, isLoading } = useDefaultCatalog('ai', row.category);
  const options = data?.options ?? [];
  const empty = !isLoading && options.length === 0;

  const value =
    row.providerId && row.version
      ? { providerId: row.providerId, version: row.version, model: row.model }
      : null;
  const isAuto = row.source === 'auto' || row.source === null;

  return (
    <div className="flex flex-col gap-[8px] p-[16px] rounded-[8px] border border-newTableBorder bg-newBgColorInner">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[14px] font-[600] text-textColor">
            {t(CATEGORY_LABELS[row.category][0], CATEGORY_LABELS[row.category][1])}
          </div>
          <div className="text-[12px] text-newTextColor/60">
            {t(CATEGORY_HELP[row.category][0], CATEGORY_HELP[row.category][1])}
          </div>
        </div>
        {!empty && row.source === 'stored' && (
          <Button
            type="button"
            secondary
            onClick={() => onSave(row.category, null)}
            loading={saving}
          >
            {t('reset_to_auto', 'Reset to Auto')}
          </Button>
        )}
      </div>
      <DefaultModelSelect
        options={options}
        isLoading={isLoading}
        disabled={empty}
        label={t(
          'default_model_for_category',
          'Default model for {{category}}',
          { category: t(CATEGORY_LABELS[row.category][0], CATEGORY_LABELS[row.category][1]) }
        )}
        value={value}
        onChange={(newValue) => {
          if (!newValue) return;
          onSave(row.category, newValue);
        }}
      />
      {empty ? (
        <div className="text-[11px] text-newTextColor/60">
          {t(
            'no_ai_providers_enabled',
            'No AI providers enabled — enable one in Settings → AI to set a default.'
          )}
        </div>
      ) : (
        isAuto && (
          <div className="text-[11px] text-newTextColor/60">
            {t('auto_default', 'Auto — picks a model from your enabled providers.')}
          </div>
        )
      )}
    </div>
  );
};

export const ModelDefaultsTab: React.FC = () => {
  const t = useT();
  const toaster = useToaster();
  const { data, mutate, isLoading } = useModelDefaults();
  const fetch = useFetch();
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const rows = useMemo<ModelDefaultRow[]>(() => {
    return (
      data?.categories ??
      AI_MODEL_CATEGORIES.map((category) => ({
        category,
        source: null as 'stored' | 'auto' | null,
      }))
    );
  }, [data]);

  const saveDefault = useCallback(
    async (
      category: AiModelCategory,
      value: { providerId: string; version: string; model?: string } | null
    ) => {
      setSaving((prev) => ({ ...prev, [category]: true }));
      try {
        if (!value) {
          const res = await fetch(`/settings/ai/defaults/${category}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw createFetchError('failed_to_reset_default', 'Failed to reset default');
        } else {
          const res = await fetch(`/settings/ai/defaults/${category}`, {
            method: 'PUT',
            body: JSON.stringify({
              providerId: value.providerId,
              version: value.version,
              model: value.model,
            }),
          });
          if (!res.ok) throw createFetchError('failed_to_save_default', 'Failed to save default');
        }
        await mutate();
        toaster.show(t('default_saved', 'Default saved'), 'success');
      } catch (e) {
        toaster.show(
          (e as Error).message || t('failed_to_save_default', 'Failed to save default'),
          'warning'
        );
      } finally {
        setSaving((prev) => ({ ...prev, [category]: false }));
      }
    },
    [fetch, mutate, toaster, t]
  );

  if (isLoading || !data) {
    return <div className="text-newTextColor/60 text-[14px]">{t('loading', 'Loading')}</div>;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      {rows.map((row) => (
        <AiDefaultRow
          key={row.category}
          row={row}
          saving={!!saving[row.category]}
          onSave={saveDefault}
        />
      ))}
    </div>
  );
};
