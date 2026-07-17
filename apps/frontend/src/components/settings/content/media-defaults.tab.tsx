'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/react/form/button';
import {
  AI_MEDIA_CATEGORIES,
  MEDIA_CATEGORY_OPERATION,
  type AiMediaCategory,
} from '@gitroom/nestjs-libraries/ai/defaults/default-categories';
import {
  DefaultModelSelect,
  useDefaultCatalog,
} from '@gitroom/frontend/components/settings/shared/default-model-select';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { StudioForm } from '@gitroom/frontend/components/media-tools/studio-kit/studio-form';
import type {
  StudioDescriptor,
  StudioField,
  StudioFieldValue,
} from '@gitroom/frontend/components/media-tools/studio-kit/types';
import i18next from '@gitroom/react/translation/i18next';

interface MediaDefaultRow {
  category: AiMediaCategory;
  providerId?: string;
  version?: string;
  model?: string;
  settings?: Record<string, unknown>;
  source: 'stored' | 'auto' | null;
}

interface MediaDefaultsResponse {
  categories: MediaDefaultRow[];
}

const GROUPS: { titleKey: [string, string]; categories: AiMediaCategory[] }[] = [
  {
    titleKey: ['media_group_image', 'Image'],
    categories: [
      'text-to-image',
      'image-to-image',
      'image-upscale',
      'image-bg-remove',
      'image-inpaint',
      'image-focal-point',
      'image-slide',
    ],
  },
  {
    titleKey: ['media_group_video', 'Video'],
    categories: [
      'text-to-video',
      'image-to-video',
      'video-to-video',
      'video-background',
      'video-upscale',
      'video-avatar',
      'video-caption',
    ],
  },
  {
    titleKey: ['media_group_audio', 'Audio'],
    categories: ['text-to-speech', 'text-to-music'],
  },
];

const CATEGORY_LABELS: Record<AiMediaCategory, [string, string]> = {
  'text-to-speech': ['ai_media_category_text_to_speech', 'Text to Speech'],
  'text-to-music': ['ai_media_category_text_to_music', 'Text to Music'],
  'text-to-image': ['ai_media_category_text_to_image', 'Text to Image'],
  'text-to-video': ['ai_media_category_text_to_video', 'Text to Video'],
  'image-to-image': ['ai_media_category_image_to_image', 'Image to Image'],
  'image-to-video': ['ai_media_category_image_to_video', 'Image to Video'],
  'image-upscale': ['ai_media_category_image_upscale', 'Image Upscale'],
  'image-bg-remove': ['ai_media_category_image_bg_remove', 'Remove Background'],
  'image-inpaint': ['ai_media_category_image_inpaint', 'Inpaint'],
  'image-focal-point': ['ai_media_category_image_focal_point', 'Focal Point'],
  'image-slide': ['ai_media_category_image_slide', 'Slide Generator'],
  'video-avatar': ['ai_media_category_video_avatar', 'Avatar Video'],
  'video-caption': ['ai_media_category_video_caption', 'Caption Burn-in'],
  'video-to-video': ['ai_media_category_video_to_video', 'Video to Video'],
  'video-background': ['ai_media_category_video_background', 'Video Background'],
  'video-upscale': ['ai_media_category_video_upscale', 'Video Upscale'],
};

const CATEGORY_HELP: Record<AiMediaCategory, [string, string]> = {
  'text-to-speech': ['ai_media_category_help_text_to_speech', 'Voice used for narration and TTS.'],
  'text-to-music': ['ai_media_category_help_text_to_music', 'Music/audio generation from a prompt.'],
  'text-to-image': ['ai_media_category_help_text_to_image', 'Default image generator.'],
  'text-to-video': ['ai_media_category_help_text_to_video', 'Default text-to-video model.'],
  'image-to-image': ['ai_media_category_help_image_to_image', 'Image editing/transformation.'],
  'image-to-video': ['ai_media_category_help_image_to_video', 'Image-to-video generation.'],
  'image-upscale': ['ai_media_category_help_image_upscale', 'Image upscaling/enhancement.'],
  'image-bg-remove': ['ai_media_category_help_image_bg_remove', 'Background removal for images.'],
  'image-inpaint': ['ai_media_category_help_image_inpaint', 'Inpainting with a mask.'],
  'image-focal-point': [
    'ai_media_category_help_image_focal_point',
    'Vision model used to detect focal points.',
  ],
  'image-slide': [
    'ai_media_category_help_image_slide',
    'Frame image model for slideshows. Narration uses your Text to Speech default; the slide breakdown uses your High Reasoning default.',
  ],
  'video-avatar': ['ai_media_category_help_video_avatar', 'Avatar/talking-head video.'],
  'video-caption': [
    'ai_media_category_help_video_caption',
    'Speech-to-text provider for caption burn-in.',
  ],
  'video-to-video': ['ai_media_category_help_video_to_video', 'Video restyle/transformation.'],
  'video-background': [
    'ai_media_category_help_video_background',
    'Video background removal/replacement.',
  ],
  'video-upscale': ['ai_media_category_help_video_upscale', 'Video upscaling/enhancement.'],
};

const NO_SETTINGS_CATEGORIES: AiMediaCategory[] = ['image-focal-point'];

interface ProviderCatalogItem {
  providerId: string;
  version: string;
  displayName: string;
  description?: Record<string, string>;
  website?: string;
}

const useMediaProviderCatalog = () => {
  const fetch = useFetch();
  const load = useCallback(
    async () =>
      (await (
        await fetch('/providers/catalog?domain=media')
      ).json()) as ProviderCatalogItem[],
    [fetch]
  );
  return useSWR('/providers/catalog?domain=media', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const useMediaDefaults = () => {
  const fetch = useFetch();
  const load = useCallback(
    async () =>
      (await fetch('/settings/content/media-defaults')).json() as Promise<MediaDefaultsResponse>,
    [fetch]
  );
  return useSWR('/settings/content/media-defaults', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

// Dynamic loaders for descriptor-driven kit studios. Each loader is isolated so
// webpack can code-split the descriptor modules.
const DESCRIPTOR_LOADERS: Record<string, () => Promise<StudioDescriptor>> = {
  runway: async () => (await import('../../media-tools/runway/descriptor')).runwayDescriptor,
  luma: async () => (await import('../../media-tools/luma/descriptor')).lumaDescriptor,
  minimax: async () => (await import('../../media-tools/minimax/descriptor')).minimaxDescriptor,
  qwen: async () => (await import('../../media-tools/qwen/descriptor')).qwenDescriptor,
  togetherai: async () =>
    (await import('../../media-tools/togetherai/descriptor')).togetheraiDescriptor,
  siliconflow: async () =>
    (await import('../../media-tools/siliconflow/descriptor')).siliconflowDescriptor,
  groq: async () => (await import('../../media-tools/groq/descriptor')).groqDescriptor,
  openrouter: async () =>
    (await import('../../media-tools/openrouter/descriptor')).openrouterDescriptor,
  fireworks: async () =>
    (await import('../../media-tools/fireworks/descriptor')).fireworksDescriptor,
  deepinfra: async () =>
    (await import('../../media-tools/deepinfra/descriptor')).deepinfraDescriptor,
  gateway: async () => (await import('../../media-tools/gateway/descriptor')).gatewayDescriptor,
  bedrock: async () => (await import('../../media-tools/bedrock/descriptor')).bedrockDescriptor,
  azure: async () => (await import('../../media-tools/azure/descriptor')).azureDescriptor,
  xai: async () => (await import('../../media-tools/xai/descriptor')).xaiDescriptor,
  wan: async () => (await import('../../media-tools/wan/descriptor')).wanDescriptor,
  higgsfield: async () =>
    (await import('../../media-tools/higgsfield/descriptor')).higgsfieldDescriptor,
  ltx: async () => (await import('../../media-tools/ltx/descriptor')).ltxDescriptor,
  suno: async () => (await import('../../media-tools/suno/descriptor')).sunoDescriptor,
  reelfarm: async () =>
    (await import('../../media-tools/reelfarm/descriptor')).reelfarmDescriptor,
  genviral: async () =>
    (await import('../../media-tools/genviral/descriptor')).genviralDescriptor,
  did: async () => (await import('../../media-tools/did/descriptor')).didDescriptor,
  hedra: async () => (await import('../../media-tools/hedra/descriptor')).hedraDescriptor,
  tavus: async () => (await import('../../media-tools/tavus/descriptor')).tavusDescriptor,
  elevenlabs: async () =>
    (await import('../../media-tools/elevenlabs/descriptor')).elevenlabsDescriptor,
  'black-forest-labs': async () =>
    (await import('../../media-tools/black-forest-labs/descriptor')).blackForestLabsDescriptor,
  'stability-ai': async () =>
    (await import('../../media-tools/stability-ai/descriptor')).stabilityDescriptor,
  recraft: async () => (await import('../../media-tools/recraft/descriptor')).recraftDescriptor,
  ideogram: async () =>
    (await import('../../media-tools/ideogram/descriptor')).ideogramDescriptor,
  leonardo: async () =>
    (await import('../../media-tools/leonardo/descriptor')).leonardoDescriptor,
  google: async () =>
    (await import('../../media-tools/google-ai/descriptor')).googleAiDescriptor,
  vertex: async () => (await import('../../media-tools/vertex/descriptor')).vertexDescriptor,
  deepgram: async () =>
    (await import('../../media-tools/deepgram/descriptor')).deepgramDescriptor,
  openai: async () => (await import('../../media-tools/openai/descriptor')).openaiDescriptor,
  sora: async () => (await import('../../media-tools/sora/descriptor')).soraDescriptor,
  fal: async () => (await import('../../media-tools/kling/descriptor')).klingDescriptor,
  pika: async () => (await import('../../media-tools/pika/descriptor')).pikaDescriptor,
  kling: async () => (await import('../../media-tools/kling/descriptor')).klingDescriptor,
};

async function loadDescriptor(
  providerId: string,
  category: AiMediaCategory,
  model?: string
): Promise<StudioDescriptor | null> {
  const operation = MEDIA_CATEGORY_OPERATION[category];

  // OpenAI video defaults use the Sora descriptor even though the credential
  // provider is `openai`.
  if (providerId === 'openai' && operation === 'video') {
    return DESCRIPTOR_LOADERS.sora?.();
  }

  // fal hosts both Kling and Pika; disambiguate by model id when possible.
  if (providerId === 'fal' && model?.toLowerCase().includes('pika')) {
    return DESCRIPTOR_LOADERS.pika?.();
  }

  const loader = DESCRIPTOR_LOADERS[providerId];
  if (!loader) return null;
  return loader();
}

// StudioTab.operation is only image|video|audio; MEDIA_CATEGORY_OPERATION is the finer
// MediaOperation. Collapse to the coarse tab operation (mirrors the backend
// `_listOperationForCategory`) so descriptor tabs can be matched to a category.
function coarseOperation(category: AiMediaCategory): 'image' | 'video' | 'audio' {
  const op = MEDIA_CATEGORY_OPERATION[category];
  switch (op) {
    case 'video':
    case 'avatar':
    case 'video-bg':
    case 'video-upscale':
      return 'video';
    case 'tts':
    case 'stt':
    case 'caption':
    case 'audio':
      return 'audio';
    default:
      return 'image';
  }
}

function descriptorFieldsForCategory(
  descriptor: StudioDescriptor,
  category: AiMediaCategory,
  model?: string
): StudioField[] | null {
  const operation = coarseOperation(category);
  const tabs = descriptor.tabs.filter(
    (t) => t.operation === operation && !t.custom
  );
  if (tabs.length === 0) return null;

  let tab = tabs.find((t) => t.key === category);
  if (!tab && model) {
    tab =
      tabs.find((t) => t.model === model) ||
      tabs.find((t) =>
        t.fields.some(
          (f) =>
            f.type === 'select' &&
            f.name === 'model' &&
            f.options?.some((o) => o.value === model)
        )
      );
  }
  if (!tab) tab = tabs[0];

  // Persist only non-runtime tunables: drop the prompt input, media file refs, and the
  // model field (the model is chosen in the main dropdown, not the settings form).
  return tab.fields.filter(
    (f) => f.type !== 'prompt' && f.type !== 'media' && f.name !== 'model'
  );
}

function initialFormValues(
  fields: StudioField[],
  settings?: Record<string, unknown>
): Record<string, StudioFieldValue> {
  const out: Record<string, StudioFieldValue> = {};
  for (const field of fields) {
    const stored = settings?.[field.name];
    if (stored !== undefined) {
      out[field.name] = stored as StudioFieldValue;
    } else if (field.type === 'toggle') {
      out[field.name] = field.default ?? false;
    } else if (field.type === 'number') {
      out[field.name] = field.default ?? '';
    } else if (field.type === 'select') {
      out[field.name] = field.default ?? '';
    } else {
      out[field.name] = '';
    }
  }
  return out;
}

// One category = one row component. It owns the catalog hook (rules-of-hooks: can't live in
// the parent's `.map`) and its own descriptor/draft state. The model field is a native
// dropdown of the org's selectable models for this category (from the catalog); when the
// catalog is empty the field is DISABLED with an honest message (no fake "Auto"). Settings
// are the structured StudioForm only; when the provider/model has no tunables the settings
// area shows a disabled placeholder — never a raw JSON box.
const MediaCategoryRow: React.FC<{
  row: MediaDefaultRow;
  saving: boolean;
  catalog: ProviderCatalogItem[] | undefined;
  onSave: (
    category: AiMediaCategory,
    value: { providerId: string; version: string; model?: string } | null,
    settings?: Record<string, unknown> | null
  ) => void;
}> = ({ row, saving, catalog, onSave }) => {
  const t = useT();
  const category = row.category;
  const { data: catalogData, isLoading: catalogLoading } = useDefaultCatalog(
    'media',
    category
  );

  // The backend catalog is the single source of truth: it already enumerates each provider's
  // models (with their per-model settings `fields`) from metadata. Render its options
  // directly — no frontend descriptor scraping, no live `/media/studio/:provider/models` fan-out.
  const options = useMemo(() => catalogData?.options ?? [], [catalogData]);
  const optionsLoading = catalogLoading;
  // `empty` = no provider can serve this category → the field is disabled with an honest
  // message (never a fake "Auto" / free-text). A provider with no enumerable models still
  // yields a provider-level option, so a configured provider is always selectable.
  const empty = !optionsLoading && options.length === 0;

  const value = useMemo(
    () =>
      row.providerId && row.version
        ? { providerId: row.providerId, version: row.version, model: row.model }
        : null,
    [row.providerId, row.version, row.model]
  );
  const isAuto = row.source === 'auto' || row.source === null;
  const showSettings = !NO_SETTINGS_CATEGORIES.includes(category);

  // Per-row descriptor fields + draft, re-derived when the resolved provider/model changes.
  const [fields, setFields] = useState<StudioField[] | null>(null);
  const [draft, setDraft] = useState<Record<string, StudioFieldValue>>({});
  const sigRef = useRef<string | null>(null);

  const selectedOption = useMemo(
    () =>
      value
        ? options.find(
            (o) =>
              o.providerId === value.providerId &&
              o.version === value.version &&
              o.model === value.model
          ) ?? null
        : null,
    [options, value]
  );

  // Async-only state updates (inside .then) — never call setState synchronously in the
  // effect body. When there is no provider the settings block isn't rendered (see below),
  // so stale `fields` can't leak into the UI.
  const canShowSettings = !empty && showSettings && !!row.providerId;
  useEffect(() => {
    if (!canShowSettings || !row.providerId) return;
    let cancelled = false;
    const operation = MEDIA_CATEGORY_OPERATION[category];
    const sig = `${row.providerId}::${row.model ?? ''}::${operation}`;
    if (sigRef.current === sig) return;

    const applyFields = (f: StudioField[] | null) => {
      sigRef.current = sig;
      if (!f || f.length === 0) {
        setFields(null);
        return;
      }
      setFields(f);
      setDraft(initialFormValues(f, row.settings));
    };

    // Prefer the fields shipped with the selected catalog option (snapshot/direct
    // providers and kit providers now emit them from metadata). Fall back to the
    // on-demand descriptor loader for dynamic hubs and legacy paths.
    if (selectedOption?.fields && selectedOption.fields.length > 0) {
      applyFields(selectedOption.fields);
      return;
    }

    loadDescriptor(row.providerId, category, row.model).then((descriptor) => {
      if (cancelled) return;
      const f = descriptor
        ? descriptorFieldsForCategory(descriptor, category, row.model)
        : null;
      applyFields(f);
    });
    return () => {
      cancelled = true;
    };
  }, [canShowSettings, row.providerId, row.model, row.settings, category, selectedOption]);

  const hasForm = canShowSettings && !!fields && fields.length > 0;

  const providerInfo = useMemo(
    () =>
      catalog?.find(
        (p) => p.providerId === row.providerId && p.version === row.version
      ),
    [catalog, row.providerId, row.version]
  );
  // resolvedLanguage collapses a region-suffixed locale (e.g. `es-ES`) to the base code our
  // description map is keyed by (`es`); fall back to `language`, then to the required `en`.
  const lang = i18next.resolvedLanguage || i18next.language;
  const description =
    providerInfo?.description?.[lang] || providerInfo?.description?.en;

  return (
    <div className="flex flex-col gap-[10px] p-[16px] rounded-[8px] border border-newTableBorder bg-newBgColorInner">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-[14px] font-[600] text-textColor">
            {t(CATEGORY_LABELS[category][0], CATEGORY_LABELS[category][1])}
          </div>
          <div className="text-[12px] text-newTextColor/60">
            {t(CATEGORY_HELP[category][0], CATEGORY_HELP[category][1])}
          </div>
        </div>
        {!empty && row.source === 'stored' && (
          <Button
            type="button"
            secondary
            onClick={() => onSave(category, null)}
            loading={saving}
          >
            {t('reset_to_auto', 'Reset to Auto')}
          </Button>
        )}
      </div>

      <DefaultModelSelect
        options={options}
        isLoading={optionsLoading}
        disabled={empty}
        label={t(
          'default_model_for_category',
          'Default model for {{category}}',
          { category: t(CATEGORY_LABELS[category][0], CATEGORY_LABELS[category][1]) }
        )}
        value={value}
        onChange={(newValue) => {
          if (!newValue) return;
          onSave(category, newValue);
        }}
      />

      {description && (
        <div className="text-[11px] text-newTextColor/70 leading-[1.4]">
          {description}
          {providerInfo?.website && (
            <>
              {' '}
              <a
                href={providerInfo.website}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-textColor"
              >
                {t('learn_more', 'Learn more')}
              </a>
            </>
          )}
        </div>
      )}

      {!empty && showSettings && (
        <div className="flex flex-col gap-[6px]">
          {hasForm ? (
            <>
              <div className="text-[12px] text-newTextColor/70">
                {t('default_settings', 'Default settings')}
              </div>
              <StudioForm
                fields={fields!}
                values={draft}
                onChange={(name, val) =>
                  setDraft((prev) => ({ ...prev, [name]: val }))
                }
                provider={row.providerId ?? ''}
                operation={MEDIA_CATEGORY_OPERATION[category]}
                keyNs={`media_defaults_${row.providerId ?? ''}`}
                tabKey={category}
              />
              <Button
                type="button"
                onClick={() => {
                  const cleaned: Record<string, unknown> = {};
                  for (const f of fields!) {
                    const v = draft?.[f.name];
                    if (v !== undefined && v !== '' && v !== null) {
                      cleaned[f.name] = v;
                    }
                  }
                  onSave(category, value, cleaned);
                }}
                loading={saving}
                className="self-start"
              >
                {t('save_settings', 'Save settings')}
              </Button>
            </>
          ) : (
            <div className="px-[12px] py-[9px] rounded-[8px] border border-newTableBorder bg-newBgColorInner text-[12px] text-newTextColor/60 select-none">
              {t('no_settings_for_provider', 'No settings for this provider/model.')}
            </div>
          )}
        </div>
      )}

      {empty ? (
        <div className="text-[11px] text-newTextColor/60">
          {t(
            'no_media_providers_enabled',
            'No media providers enabled — enable one in Settings → Media.'
          )}
        </div>
      ) : (
        isAuto && (
          <div className="text-[11px] text-newTextColor/60">
            {t(
              'auto_default_media',
              'Auto — picks a provider from your enabled media providers.'
            )}
          </div>
        )
      )}
    </div>
  );
};

export const MediaDefaultsTab: React.FC = () => {
  const t = useT();
  const toaster = useToaster();
  const { data, mutate, isLoading } = useMediaDefaults();
  const { data: providerCatalog } = useMediaProviderCatalog();
  const fetch = useFetch();
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  const rows = useMemo<MediaDefaultRow[]>(() => {
    return (
      data?.categories ??
      AI_MEDIA_CATEGORIES.map((category) => ({
        category,
        source: null as 'stored' | 'auto' | null,
      }))
    );
  }, [data]);

  const rowsByCategory = useMemo(() => {
    const map = new Map<string, MediaDefaultRow>();
    for (const row of rows) map.set(row.category, row);
    return map;
  }, [rows]);

  const saveDefault = useCallback(
    async (
      category: AiMediaCategory,
      value: { providerId: string; version: string; model?: string } | null,
      settings?: Record<string, unknown> | null
    ) => {
      setSaving((prev) => ({ ...prev, [category]: true }));
      try {
        if (!value) {
          const res = await fetch(`/settings/content/media-defaults/${category}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw createFetchError('failed_to_reset_default', 'Failed to reset default');
        } else {
          const body: Record<string, unknown> = {
            providerId: value.providerId,
            version: value.version,
          };
          if (value.model) body.model = value.model;
          if (settings) body.settings = settings;
          const res = await fetch(`/settings/content/media-defaults/${category}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw createFetchError('failed_to_save_default', errText || 'Failed to save default');
          }
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
    <div className="flex flex-col gap-[24px]">
      {GROUPS.map((group) => (
        <div key={group.titleKey[0]}>
          <div className="text-[16px] font-[600] text-textColor mb-[12px]">
            {t(group.titleKey[0], group.titleKey[1])}
          </div>
          <div className="flex flex-col gap-[12px]">
            {group.categories.map((category) => {
              const row =
                rowsByCategory.get(category) ??
                ({ category, source: null } as MediaDefaultRow);
              return (
                <MediaCategoryRow
                  key={category}
                  row={row}
                  saving={!!saving[category]}
                  catalog={providerCatalog}
                  onSave={saveDefault}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
