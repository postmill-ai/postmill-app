import { getMetadataStorage } from 'class-validator';
import {
  allProviders,
  EmptySettings,
} from '@postmill-ai/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';

/**
 * Cross-cutting settings keys that are legal on EVERY provider's settings blob
 * (they are platform features, not provider-specific settings):
 * - `color`        — the composer's group heading colour; stored in `settings`
 *                    (PostsRepository.setGroupColor) and round-tripped on edit.
 * - `firstComment` — auto-posted after publish; post-publish.ts reads
 *                    `settings.firstComment` and gates on PROVIDER_CAPABILITIES
 *                    + the adapter implementing `comment()`.
 * - `firstCommentId` / `firstCommentReleaseURL` / `firstCommentPostedAt` —
 *   first-comment idempotency markers written into stored settings by
 *   post-publish.ts after the comment posts; the publish step gates re-posting
 *   on them. They must survive an edit-resave, or re-queued/recurring posts
 *   publish the first comment again.
 */
export const CROSS_CUTTING_SETTINGS_KEYS = [
  'color',
  'firstComment',
  'firstCommentId',
  'firstCommentReleaseURL',
  'firstCommentPostedAt',
] as const;

/**
 * Internal-plug config keys (`plug--<name>--<field>`) are dynamic — registered
 * on the composer form per configured plug and consumed from stored settings at
 * publish (PostsService.checkInternalPlug) — so they can't be declared on a DTO.
 * They pass the sanitizer by prefix.
 */
export const INTERNAL_PLUG_KEY_PREFIX = 'plug-';

const providerDtoMap = new Map<string, any>(
  allProviders(EmptySettings).map((p: { name: string; value: any }) => [
    p.name,
    p.value,
  ])
);

/** The settings DTO class for a provider identifier (EmptySettings for `None` providers). */
export const providerSettingsDto = (identifier?: string | null) =>
  identifier ? providerDtoMap.get(identifier) : undefined;

export const knownProviderIdentifiers = () => [...providerDtoMap.keys()];

const declaredKeysCache = new WeakMap<object, Set<string>>();

/**
 * Keys declared on a settings DTO via class-validator decorators, walking the
 * prototype chain so inherited (base-class) keys are included.
 */
export const declaredSettingsKeys = (dto: any): Set<string> => {
  const cached = declaredKeysCache.get(dto);
  if (cached) {
    return cached;
  }

  const keys = new Set<string>();
  let target = dto;
  while (typeof target === 'function' && target !== Function.prototype) {
    for (const meta of getMetadataStorage().getTargetValidationMetadatas(
      target,
      null as any,
      false,
      false
    )) {
      keys.add(meta.propertyName);
    }
    target = Object.getPrototypeOf(target);
  }

  declaredKeysCache.set(dto, keys);
  return keys;
};

export const isAllowedSettingsKey = (dto: any, key: string) =>
  declaredSettingsKeys(dto).has(key) ||
  (CROSS_CUTTING_SETTINGS_KEYS as readonly string[]).includes(key) ||
  key.startsWith(INTERNAL_PLUG_KEY_PREFIX);

/**
 * Strips settings keys the provider does not support (foreign keys leaked by
 * shared composer fields) while keeping the provider's DTO-declared keys, the
 * cross-cutting keys and internal-plug keys. Unknown providers pass through
 * untouched — validation downstream rejects them with a useful error.
 */
export const sanitizeProviderSettings = (
  identifier: string | undefined | null,
  settings: any
): Record<string, any> => {
  const input =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? settings
      : {};
  const dto = providerSettingsDto(identifier);
  if (!dto) {
    return { ...input };
  }

  const allowed = declaredSettingsKeys(dto);
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(input)) {
    if (
      allowed.has(key) ||
      (CROSS_CUTTING_SETTINGS_KEYS as readonly string[]).includes(key) ||
      key.startsWith(INTERNAL_PLUG_KEY_PREFIX)
    ) {
      clean[key] = value;
    }
  }
  return clean;
};
