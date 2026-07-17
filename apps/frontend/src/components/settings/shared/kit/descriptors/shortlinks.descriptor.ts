import {
  ProviderRow,
  ProviderSurfaceDescriptor,
  SurfaceFetch,
} from '../provider-surface.types';
import { createFetchError } from '../../fetch-error';
import {
  ShortlinkProviderInfo,
  ShortlinksConfigResponse,
} from '@gitroom/frontend/components/settings/shortlinks/hooks/useShortlinksConfig';

/**
 * Short-link provider settings surface descriptor (migrated from
 * `shortlinks/shortlinks.tab.tsx` + `shortlinks/shortlink-provider-form.tsx`).
 *
 * The `/settings/shortlinks/config` envelope already carries the per-org provider
 * state AND the catalog credential field schema on each `providers[]` row, so
 * `load` maps it straight to `ProviderRow`s and forwards the raw object through
 * `meta` (the generic form reads `meta.credentialFields`). Shortlinks has no
 * independent enable toggle — the backend `PUT …/config/:id` always sets
 * `enabled: true` — so `features.toggle` is `false` (configured == enabled).
 */

const CAPABILITY_KEYS = [
  'create',
  'expand',
  'statistics',
  'bulkStatistics',
  'customDomain',
] as const;

const CAPABILITY_LABELS: Record<string, string> = {
  create: 'Create links',
  expand: 'Expand links',
  statistics: 'Stats',
  bulkStatistics: 'Bulk stats',
  customDomain: 'Custom domain',
};

const CAPABILITY_COLORS: Record<string, string> = {
  create: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  expand: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-400',
  statistics: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  bulkStatistics: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  customDomain: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
};

export const shortlinksDescriptor: ProviderSurfaceDescriptor<ShortlinkProviderInfo> = {
  key: 'shortlinks',
  basePath: '/settings/shortlinks',
  swrKey: 'org-shortlinks-config',
  catalogDomain: 'shortlink',
  title: 'Shortlinks',
  description:
    'Connect a link-shortening service so long URLs in your posts become short, trackable links.',

  load: async (fetch: SurfaceFetch) => {
    const res = await fetch('/settings/shortlinks/config');
    if (!res.ok) throw createFetchError('failed_to_load_shortlinks_config', 'Failed to load shortlinks config');
    const config: ShortlinksConfigResponse = await res.json();

    const rows: ProviderRow<ShortlinkProviderInfo>[] = (config.providers ?? []).map(
      (p) => ({
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        isConfigured: p.isConfigured,
        isPrimary: p.isActive,
        // Shortlinks has no independent enable column today — keep
        // configured == enabled so the prior behaviour is preserved.
        enabled: p.isConfigured,
        capabilities: CAPABILITY_KEYS.filter((k) => p.capabilities?.[k]),
        version: p.version,
        meta: {
          ...p,
          oauthSessionKey: 'oauth_shortlink_provider',
          oauthTab: 'shortlinks',
          oauthConnectLabel: `Connect with ${p.name}`,
        },
      }),
    );

    return { rows };
  },

  features: { primary: true, toggle: false, remove: true, test: true, multiInstance: true },

  filter: { search: true },

  capabilityMeta: Object.fromEntries(
    CAPABILITY_KEYS.map((key) => [
      key,
      { label: CAPABILITY_LABELS[key], color: CAPABILITY_COLORS[key] },
    ]),
  ),

  form: {
    instanceName: true,
    oauth: true,
    extraFields: [
      { type: 'instance-name', key: 'name' },
      { type: 'oauth-block', key: 'oauth' },
      { type: 'custom-domain', key: 'customDomain' },
    ],
    credentialFieldsFromMeta: (m) => m?.credentialFields ?? [],
    buildBody: (state) => ({
      name: state.name || undefined,
      credentials: Object.values(state.credentials).some((v) => v)
        ? state.credentials
        : undefined,
      customDomain: state.extra.customDomain || undefined,
      extraConfig:
        state.extra.clientId || state.extra.clientSecret
          ? {
              ...(state.extra.clientId ? { clientId: state.extra.clientId } : {}),
              ...(state.extra.clientSecret
                ? { clientSecret: state.extra.clientSecret }
                : {}),
            }
          : undefined,
      version: state.version || undefined,
    }),
    buildTestBody: (state) => ({
      credentials: state.credentials,
      customDomain: state.extra.customDomain || undefined,
    }),
    seedState: (meta) =>
      meta?.customDomain ? { extra: { customDomain: meta.customDomain } } : {},
  },
};
