import {
  ProviderSurfaceDescriptor,
  ProviderRow,
  ProviderFormState,
  CapabilityMeta,
  KitCredentialField,
} from '../provider-surface.types';
import { createFetchError } from '../../fetch-error';
import {
  ContentPackConfigResponse,
  ContentPackProviderInfo,
} from '@gitroom/frontend/components/settings/content-packs/hooks/useContentPacksConfig';

/**
 * Content Packs provider settings surface descriptor (Provider Settings Kit).
 *
 * Content Packs diverge from the other surfaces in two ways the kit already
 * accommodates:
 *   1. There is NO per-row `enabled` toggle column — `features.toggle` is false.
 *      We map `enabled` to `isConfigured` purely so the panel's Make-Primary
 *      button (which gates on `row.enabled`) shows for configured-but-not-Primary
 *      packs.
 *   2. "Primary" is a single org-wide POINTER (`Organization.activeContentPack
 *      Identifier`), not a per-row flag. Making a premium pack Primary uses the
 *      built-in `set-active` route. Reverting to the free "Postmill (Default)"
 *      pack is a SEPARATE `/deactivate` endpoint that has no per-row equivalent,
 *      so the tab renders that control itself via the panel's `children` slot.
 *
 * The catalog domain is the single word `contentpack` (kernel identity domain),
 * NOT `content-pack`.
 */

const CAPABILITY_LABELS: Record<string, string> = {
  photos: 'Photos',
  videos: 'Videos',
  vectors: 'Vectors',
  icons: 'Icons',
  audio: 'Audio',
  stickers: 'Stickers',
};

const CAPABILITY_COLORS: Record<string, string> = {
  photos: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  videos: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  vectors: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  icons: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  audio: 'bg-pink-500/20 text-pink-800 dark:text-pink-400',
  stickers: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400',
};

const capabilityMeta: Record<string, CapabilityMeta> = Object.fromEntries(
  Object.keys(CAPABILITY_LABELS).map(
    (key): [string, CapabilityMeta] => [
      key,
      { label: CAPABILITY_LABELS[key], color: CAPABILITY_COLORS[key] },
    ],
  ),
);

export const contentPacksDescriptor: ProviderSurfaceDescriptor<ContentPackProviderInfo> =
  {
    key: 'content-packs',
    title: 'Content Packs',
    titleKey: 'content_packs',
    description:
      'A content pack is the stock media library that powers searches for photos, videos, vectors, stickers, icons and audio across the app.',
    descriptionKey: 'content_packs_description',
    basePath: '/settings/content-packs',
    swrKey: 'org-content-packs-config',
    catalogDomain: 'contentpack',

    load: async (fetch) => {
      const res = await fetch('/settings/content-packs/config');
      if (!res.ok) throw createFetchError('failed_to_load_content_pack_settings', 'Failed to load content pack settings');
      const data: ContentPackConfigResponse = await res.json();
      const rows: ProviderRow<ContentPackProviderInfo>[] = (
        data.providers || []
      ).map((p) => ({
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        isConfigured: p.isConfigured,
        // Primary is a pointer (isActive), not a per-row flag.
        isPrimary: p.isActive,
        // No `enabled` column — surface configured packs as "enabled" so the
        // panel's Make-Primary action (gated on `enabled`) appears.
        enabled: p.isConfigured,
        capabilities: p.capabilities,
        version: p.version,
        meta: p,
      }));
      return { rows };
    },

    // No per-row On/Off — content packs have no `enabled` column.
    features: { toggle: false, primary: true, remove: true, test: true },

    filter: { search: true },

    capabilityMeta,

    form: {
      credentialFieldsFromMeta: (m): KitCredentialField[] => {
        const fromMeta = (m as { credentialFields?: KitCredentialField[] })
          .credentialFields;
        return fromMeta?.length
          ? fromMeta
          : [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }];
      },
      buildBody: (state: ProviderFormState) => ({
        credentials: state.credentials.apiKey
          ? { apiKey: state.credentials.apiKey }
          : undefined,
      }),
      buildTestBody: (state: ProviderFormState) => ({
        credentials: { apiKey: state.credentials.apiKey },
      }),
    },
  };
