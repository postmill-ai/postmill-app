export type ProviderDomain =
  | 'ai'
  | 'media'
  | 'storage'
  | 'shortlink'
  | 'social'
  | 'vpn'
  | 'contentpack'
  | 'email'
  | 'auth';

/**
 * Single source of truth for the provider-domain set (3.3/4.5). Kept in lockstep
 * with the `ProviderDomain` union above — the `satisfies` clause makes the
 * compiler reject any drift. Consumers (manifest validation, the catalog
 * controller, featured-provider service) import this instead of re-declaring it.
 */
export const PROVIDER_DOMAINS = [
  'ai',
  'media',
  'storage',
  'shortlink',
  'social',
  'vpn',
  'contentpack',
  'email',
  'auth',
] as const satisfies readonly ProviderDomain[];

export function isProviderDomain(value: string): value is ProviderDomain {
  return (PROVIDER_DOMAINS as readonly string[]).includes(value);
}

export const DEFAULT_VERSION = 'v1';
export const QUALIFIED_SEPARATOR = '@';

export interface ProviderKey {
  domain: ProviderDomain;
  providerId: string;
  version: string;
}

export interface ParsedQualifiedId {
  providerId: string;
  version?: string;
}

export function qualify(providerId: string, version = DEFAULT_VERSION): string {
  return `${providerId}${QUALIFIED_SEPARATOR}${version}`;
}

export function parseQualified(input: string): ParsedQualifiedId {
  const sepIndex = input.lastIndexOf(QUALIFIED_SEPARATOR);
  if (sepIndex <= 0 || sepIndex === input.length - 1) {
    return { providerId: input };
  }
  return {
    providerId: input.slice(0, sepIndex),
    version: input.slice(sepIndex + 1),
  };
}

export function keyString(key: ProviderKey): string {
  return `${key.domain}/${key.providerId}${QUALIFIED_SEPARATOR}${key.version}`;
}
