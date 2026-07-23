import {
  KitCredentialField,
  ProviderRow,
  ProviderSurfaceDescriptor,
  SurfaceFetch,
} from '../provider-surface.types';
import { createFetchError } from '../../fetch-error';

/**
 * AI / LLM provider settings surface descriptor (migrated from
 * `ai/provider-form.tsx` + the `subTab==='provider'` branch of `ai/ai.tab.tsx`).
 *
 * The envelope is split across two endpoints — `/settings/ai/config` carries the
 * per-org provider state (configured / active / enabled / capabilities), while
 * `/settings/ai/providers` carries the catalog credential field schema. `load`
 * merges the credential fields onto each config row's `meta` so the generic form
 * can render them via `credentialFieldsFromMeta`.
 */

interface AICapabilities {
  text: boolean;
  image: boolean;
  vision: boolean;
  embeddings: boolean;
  speech: boolean;
  tools: boolean;
}

type AICapabilityKey = keyof AICapabilities;

const CAPABILITY_KEYS: AICapabilityKey[] = [
  'text',
  'image',
  'vision',
  'embeddings',
  'speech',
  'tools',
];

interface OrgProviderInfo {
  identifier: string;
  name: string;
  type: 'direct' | 'hub';
  enabled: boolean;
  isActive: boolean;
  isConfigured: boolean;
  version: string;
  defaultModel: string;
  reasoningModel: string;
  capabilities: AICapabilities;
  budgetMonthlyCap: number | null;
  budgetDailyCap: number | null;
  budgetAlertThresholdPct: number | null;
}

interface OrgConfigResponse {
  providers: OrgProviderInfo[];
}

const parseOptionalNumber = (value: unknown): number | undefined => {
  if (value === '' || value == null) return undefined;
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

interface ProviderInfo {
  identifier: string;
  name: string;
  type: string;
  credentialFields: KitCredentialField[];
}

/** Raw provider object carried through `ProviderRow.meta`. */
type AiMeta = OrgProviderInfo & { credentialFields: KitCredentialField[] };

const CAPABILITY_COLORS: Record<string, string> = {
  text: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  image: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  vision: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  embeddings: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  speech: 'bg-pink-500/20 text-pink-800 dark:text-pink-400',
  tools: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400',
};

const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Providers that bring their own endpoint — Base URL is a required, visible
// setting for these; hosted providers keep their canonical endpoint hidden.
const BASE_URL_PROVIDERS = new Set(['openai-compatible']);

export const aiDescriptor: ProviderSurfaceDescriptor<AiMeta> = {
  key: 'ai',
  basePath: '/settings/ai',
  swrKey: 'org-ai-config',
  catalogDomain: 'ai',
  title: 'LLM Providers',
  titleKey: 'llm_providers',
  description:
    'Choose the AI for writing and replies. Add your account key and click Set Active.',
  descriptionKey: 'llm_providers_description',

  load: async (fetch: SurfaceFetch) => {
    const [configRes, providersRes] = await Promise.all([
      fetch('/settings/ai/config'),
      fetch('/settings/ai/providers'),
    ]);
    if (!configRes.ok) throw createFetchError('failed_to_load_ai_config', 'Failed to load AI config');
    if (!providersRes.ok) throw createFetchError('failed_to_load_ai_providers', 'Failed to load AI providers');

    const config: OrgConfigResponse = await configRes.json();
    const providers: ProviderInfo[] = await providersRes.json();
    const fieldsByIdentifier = new Map(
      providers.map((p) => [p.identifier, p.credentialFields ?? []]),
    );

    const rows: ProviderRow<AiMeta>[] = (config.providers ?? []).map((p) => {
      const credentialFields = fieldsByIdentifier.get(p.identifier) ?? [];
      const capabilities: string[] = CAPABILITY_KEYS.filter(
        (c) => p.capabilities?.[c],
      );
      if (p.type === 'hub') capabilities.push('hub');
      return {
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        isConfigured: p.isConfigured,
        isPrimary: p.isActive,
        enabled: p.enabled,
        capabilities,
        version: p.version ?? 'v1',
        meta: { ...p, credentialFields },
      };
    });

    return { rows };
  },

  features: { toggle: true, primary: true, remove: true, test: true },

  filter: {
    search: true,
    capabilityChips: [
      {
        key: 'text',
        label: 'Text',
        activeClass: 'bg-blue-500/20 text-blue-800 dark:text-blue-400 border-blue-500/40',
      },
      {
        key: 'image',
        label: 'Image',
        activeClass: 'bg-purple-500/20 text-purple-800 dark:text-purple-400 border-purple-500/40',
      },
      {
        key: 'vision',
        label: 'Vision',
        activeClass: 'bg-amber-500/20 text-amber-800 dark:text-amber-400 border-amber-500/40',
      },
      {
        key: 'embeddings',
        label: 'Embeddings',
        activeClass: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400 border-emerald-500/40',
      },
      {
        key: 'speech',
        label: 'Speech',
        activeClass: 'bg-pink-500/20 text-pink-800 dark:text-pink-400 border-pink-500/40',
      },
      {
        key: 'tools',
        label: 'Tools',
        activeClass: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400 border-cyan-500/40',
      },
    ],
  },

  capabilityMeta: {
    ...Object.fromEntries(
      CAPABILITY_KEYS.map((key) => [
        key,
        { label: titleCase(key), color: CAPABILITY_COLORS[key] },
      ]),
    ),
    hub: { label: 'Hub', color: 'bg-newTableText/20 text-newTableText' },
  },

  form: {
    extraFields: [
      {
        type: 'budget-block',
        key: 'budget',
        label: 'Budget limits',
      },
    ],
    // Base URL is a user setting only for endpoint-bringing providers
    // (openai-compatible has no canonical endpoint of its own). Every hosted AI
    // adapter defaults its own canonical endpoint, so baseURL stays hidden for
    // them. The same rule runs in filterCredentialFields for the catalog
    // version-fields branch.
    credentialFieldsFromMeta: (m) =>
      (m?.credentialFields ?? []).filter(
        (f) => f.key !== 'baseURL' || BASE_URL_PROVIDERS.has(m?.identifier ?? ''),
      ),
    filterCredentialFields: (fields, identifier) =>
      fields.filter(
        (f) => f.key !== 'baseURL' || BASE_URL_PROVIDERS.has(identifier),
      ),
    // Model selection lives in Settings → AI → Model Defaults, not here.
    // Budget fields are gated by the budget-block switch: disabled ⇒ explicit
    // null ×3 (clears the columns server-side); enabled-but-empty ⇒ null (no
    // cap). The slider stores a 0–100 percentage in extra; convert to the
    // persisted 0–1 fraction here.
    buildBody: (state) => {
      const budgetEnabled = !!state.extra.budgetEnabled;
      const thresholdPct = parseOptionalNumber(state.extra.budgetAlertThresholdPct);
      return {
        credentials: state.credentials,
        version: state.version || undefined,
        budgetMonthlyCap: budgetEnabled
          ? parseOptionalNumber(state.extra.budgetMonthlyCap) ?? null
          : null,
        budgetDailyCap: budgetEnabled
          ? parseOptionalNumber(state.extra.budgetDailyCap) ?? null
          : null,
        budgetAlertThresholdPct: budgetEnabled
          ? thresholdPct != null
            ? thresholdPct / 100
            : null
          : null,
      };
    },
    buildTestBody: (state) => ({ credentials: state.credentials }),
    seedState: (meta) => ({
      extra: {
        budgetEnabled:
          meta?.budgetMonthlyCap != null ||
          meta?.budgetDailyCap != null ||
          meta?.budgetAlertThresholdPct != null,
        budgetMonthlyCap:
          meta?.budgetMonthlyCap != null ? String(meta.budgetMonthlyCap) : '',
        budgetDailyCap:
          meta?.budgetDailyCap != null ? String(meta.budgetDailyCap) : '',
        // Slider works in 0–100; the stored value is a 0–1 fraction.
        budgetAlertThresholdPct:
          meta?.budgetAlertThresholdPct != null
            ? String(Math.round(meta.budgetAlertThresholdPct * 100))
            : '',
      },
    }),
  },
};
