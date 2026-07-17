'use client';

import { ReactNode } from 'react';

/**
 * Provider Settings Kit — shared types (plan dev/PROVIDER_SETTINGS.md §1.1/§1.2).
 *
 * A "surface" is one provider-list settings tab (AI, Media, Shortlinks, VPN,
 * Content Packs, …). Each is declared as a `ProviderSurfaceDescriptor` and
 * rendered with `<ProviderSettingsPanel descriptor={…} />`. The descriptor owns
 * the per-surface envelope divergence (load + save-body assembly) so the panel,
 * hook and form stay generic.
 */

/** Minimal fetch signature compatible with `useFetch()`. */
export type SurfaceFetch = (
  url: string,
  init?: RequestInit,
) => Promise<Response>;

export type ProviderVersionStatus =
  | 'preview'
  | 'active'
  | 'deprecated'
  | 'retired';

/**
 * The normalized row carrying the raw payload — kills the §0.3.4 re-find
 * anti-pattern by passing the original object through `meta`.
 */
export interface ProviderRow<Meta = unknown> {
  /** Row id OR identifier when single-instance. */
  id: string;
  /** Provider key (openai, bitly, …). */
  identifier: string;
  name: string;
  isConfigured: boolean;
  /** Surface's call-time default (maps to the isActive column where present). */
  isPrimary: boolean;
  /** Per-provider On/Off toggle, independent of Primary. */
  enabled: boolean;
  /** Capability KEYS — label/color resolved centrally via `capabilityMeta`. */
  capabilities: string[];
  /** Pinned provider-framework version (kernel), forwarded to the config form. */
  version?: string;
  versionStatus?: ProviderVersionStatus;
  /** Sunset date for a deprecated pinned version (ISO). */
  sunsetAt?: string;
  /** The FULL original provider object. */
  meta: Meta;
}

export interface CapabilityMeta {
  label: string;
  /** Tailwind classes for the badge, e.g. `bg-blue-500/20 text-blue-800 dark:text-blue-400`. */
  color: string;
}

export interface CapabilityChip {
  key: string;
  label: string;
  /** Tailwind classes applied when the chip is active. */
  activeClass: string;
}

export type ProviderExtraFieldType =
  | 'instance-name'
  | 'custom-domain'
  | 'region-checklist'
  | 'storage-binding'
  | 'oauth-block'
  | 'text'
  | 'password'
  | 'select';

/**
 * A non-credential field rendered by the generic form below the credential
 * loop. `key` is the state key inside the form's `extra` bag. Rendering is
 * delegated to a component in `kit/fields/` keyed by `type`.
 */
export interface ProviderExtraFieldSpec {
  type: ProviderExtraFieldType;
  /** State key inside the form's `extra` record (e.g. customDomain). */
  key: string;
  label?: string;
  placeholder?: string;
  required?: boolean;
  help?: string;
  options?: { label: string; value: string }[];
}

/** Generic, surface-agnostic form state. */
export interface ProviderFormState {
  name: string;
  credentials: Record<string, string>;
  version?: string;
  /** Extra (non-credential) fields keyed by spec.key. */
  extra: Record<string, any>;
}

/** Catalog-style credential field shape (text/password/select/textarea). */
export interface KitCredentialField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: string }[];
}

export interface ProviderSurfaceFeatures {
  /** Per-provider On/Off — all surfaces EXCEPT Content Packs. */
  toggle?: boolean;
  /** Show "Make Primary" + Primary badge — all surfaces EXCEPT Storage. */
  primary?: boolean;
  /** Override the toggle verb, e.g. Storage = "Mount" / "Unmount". */
  toggleLabel?: { on: string; off: string };
  /** Default true. */
  remove?: boolean;
  test?: boolean;
  /** shortlinks/storage/channels — keyed by row id, not identifier. */
  multiInstance?: boolean;
}

export interface ProviderSurfaceDescriptor<Meta = any> {
  key: string;
  title: string;
  description?: string;
  /** i18n key for the title (resolved via `t(titleKey, title)` in the panel). */
  titleKey?: string;
  /** i18n key for the description (resolved via `t(descriptionKey, description)`). */
  descriptionKey?: string;
  /** e.g. '/settings/shortlinks' → config at `${basePath}/config`. */
  basePath: string;
  /** SWR cache key — kept identical to the legacy hook so other consumers are unaffected. */
  swrKey: string;
  /** Provider-framework domain for the catalog/version plumbing. */
  catalogDomain: string;

  /** Fetch + map raw envelope → ProviderRow[] (absorbs §0.4 envelope divergence). */
  load: (fetch: SurfaceFetch) => Promise<{ rows: ProviderRow<Meta>[] }>;

  features: ProviderSurfaceFeatures;

  filter: {
    search: boolean;
    capabilityChips?: CapabilityChip[];
  };

  capabilityMeta: Record<string, CapabilityMeta>;

  form: {
    instanceName?: boolean;
    extraFields?: ProviderExtraFieldSpec[];
    oauth?: boolean;
    /** Fallback credential fields from the raw provider when single-version. */
    credentialFieldsFromMeta?: (meta: Meta) => KitCredentialField[];
    /** Assemble the PUT body from generic state (per-surface envelope). */
    buildBody: (state: ProviderFormState, meta: Meta) => any;
    /** Assemble the test POST body (defaults to `{ credentials }`). */
    buildTestBody?: (state: ProviderFormState, meta: Meta) => any;
    /** Seed initial extra/name state when opening the form for an existing row. */
    seedState?: (meta: Meta) => Partial<ProviderFormState>;
  };

  /** Override the per-row capability check used by the chip filter. */
  rowMatchesCapability?: (row: ProviderRow<Meta>, capabilityKey: string) => boolean;

  getProviderHref?: (row: ProviderRow<Meta>) => string | undefined;

  /** Optional extra actions appended to a row's action strip. */
  renderExtraActions?: (
    row: ProviderRow<Meta>,
    helpers: { configure: (id: string) => void },
  ) => ReactNode;
}
