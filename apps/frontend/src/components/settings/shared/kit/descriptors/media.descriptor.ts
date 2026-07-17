import {
  KitCredentialField,
  ProviderFormState,
  ProviderRow,
  ProviderSurfaceDescriptor,
  SurfaceFetch,
} from '../provider-surface.types';
import { createFetchError } from '../../fetch-error';

/**
 * AI Media provider settings surface descriptor (migrated from
 * `media-providers/media-providers.tab.tsx` + `media-providers/provider-modal.tsx`).
 *
 * The envelope is split across two endpoints — `/settings/media/providers`
 * carries the catalog (name + capabilities + credential field schema), while
 * `/settings/media/config` carries the per-org state (configured / enabled /
 * isActive / version). `load` merges them onto each row's `meta` so the generic
 * form can render credential fields via `credentialFieldsFromMeta`.
 */

interface MediaCapabilities {
  image: boolean;
  video: boolean;
  audio: boolean;
  avatar: boolean;
}

type MediaCapabilityKey = keyof MediaCapabilities;

const CAPABILITY_KEYS: MediaCapabilityKey[] = ['image', 'video', 'audio', 'avatar'];

interface MediaProviderCatalogEntry {
  identifier: string;
  name: string;
  capabilities: MediaCapabilities;
  credentialFields?: KitCredentialField[] | null;
}

interface MediaProviderConfig {
  identifier: string;
  isConfigured?: boolean;
  enabled?: boolean;
  isActive?: boolean;
  version?: string;
}

/** Raw provider object carried through `ProviderRow.meta`. */
type MediaMeta = MediaProviderCatalogEntry & MediaProviderConfig;

// Most media studio routes match the provider identifier (/media/<id>); these two differ.
const ROUTE_OVERRIDES: Record<string, string> = {
  google: 'google-ai',
  fal: 'kling',
};

const DEFAULT_CREDENTIAL_FIELDS: KitCredentialField[] = [
  {
    key: 'apiKey',
    label: 'API Key',
    type: 'password',
    required: true,
    placeholder: 'Enter your API key',
  },
];

const filledCredentials = (credentials: Record<string, string>) => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(credentials)) {
    const v = value?.trim();
    if (v) out[key] = v;
  }
  return out;
};

export const mediaDescriptor: ProviderSurfaceDescriptor<MediaMeta> = {
  key: 'media',
  basePath: '/settings/media',
  swrKey: 'media-providers',
  catalogDomain: 'media',
  title: 'AI Media',
  titleKey: 'ai_media',
  description:
    'Connect tools that generate images, videos, and audio for your posts.',
  descriptionKey: 'ai_media_settings_description',

  load: async (fetch: SurfaceFetch) => {
    const [providersRes, configRes] = await Promise.all([
      fetch('/settings/media/providers'),
      fetch('/settings/media/config'),
    ]);
    if (!providersRes.ok) throw createFetchError('failed_to_load_media_providers', 'Failed to load media providers');
    const providers: MediaProviderCatalogEntry[] = await providersRes.json();
    const configData: { providers?: MediaProviderConfig[] } = configRes.ok
      ? await configRes.json()
      : { providers: [] };
    const configs = new Map<string, MediaProviderConfig>();
    for (const cfg of configData.providers || []) {
      configs.set(cfg.identifier, cfg);
    }

    const rows: ProviderRow<MediaMeta>[] = providers.map((p) => {
      const cfg = configs.get(p.identifier);
      const capabilities = CAPABILITY_KEYS.filter((c) => p.capabilities?.[c]);
      return {
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        isConfigured: cfg?.isConfigured ?? false,
        isPrimary: cfg?.isActive ?? false,
        enabled: cfg?.enabled ?? false,
        capabilities,
        version: cfg?.version ?? 'v1',
        meta: { ...p, ...cfg },
      };
    });

    return { rows };
  },

  features: { toggle: true, primary: true, remove: true, test: true },

  filter: {
    search: true,
    capabilityChips: [
      {
        key: 'image',
        label: 'Image',
        activeClass: 'bg-blue-500/20 text-blue-800 dark:text-blue-400 border-blue-500/40',
      },
      {
        key: 'video',
        label: 'Video',
        activeClass: 'bg-red-500/20 text-dangerText border-red-500/40',
      },
      {
        key: 'audio',
        label: 'Audio',
        activeClass: 'bg-green-500/20 text-green-800 dark:text-green-400 border-green-500/40',
      },
    ],
  },

  capabilityMeta: {
    image: { label: 'Image', color: 'bg-blue-500/20 text-blue-800 dark:text-blue-400' },
    video: { label: 'Video', color: 'bg-red-500/20 text-dangerText' },
    audio: { label: 'Audio', color: 'bg-green-500/20 text-green-800 dark:text-green-400' },
    avatar: { label: 'Avatar', color: 'bg-purple-500/20 text-purple-800 dark:text-purple-400' },
  },

  getProviderHref: (row) =>
    `/media/${ROUTE_OVERRIDES[row.identifier] || row.identifier}`,

  form: {
    credentialFieldsFromMeta: (m) =>
      m?.credentialFields?.length ? m.credentialFields : DEFAULT_CREDENTIAL_FIELDS,
    buildBody: (state: ProviderFormState) => {
      const filled = filledCredentials(state.credentials);
      return {
        credentials: Object.keys(filled).length ? filled : undefined,
        version: state.version || undefined,
      };
    },
    buildTestBody: (state: ProviderFormState) => {
      const filled = filledCredentials(state.credentials);
      return {
        credentials: Object.keys(filled).length ? filled : undefined,
      };
    },
  },
};
