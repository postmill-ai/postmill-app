import { ProviderDomain, ProviderKey, keyString, PROVIDER_DOMAINS } from './identity';
import { versionIsPrerelease } from './version';

export type ProviderVersionStatus = 'preview' | 'active' | 'deprecated' | 'retired';

export interface CredentialFieldOption {
  label: string;
  value: string;
}

export interface CredentialField {
  key: string;
  label: string;
  type: 'string' | 'text' | 'password' | 'textarea' | 'json' | 'select';
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: CredentialFieldOption[];
}

export interface ProviderManifest<Caps = unknown> {
  domain: ProviderDomain;
  providerId: string;
  version: string;
  displayName: string;
  status: ProviderVersionStatus;
  deprecatedAt?: string;
  sunsetAt?: string;
  credentialFields: CredentialField[];
  capabilities: Caps;
  universalCredentialFrom?: string;
  icon?: string;
  docsUrl?: string;
  /** Domain-specific UI hints. */
  setupNotes?: string;
  authType?: 'none' | 'apiKey' | 'oauth2';
  defaultDomain?: string;
}

export interface ProviderHealth {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  successCount: number;
  errorCount: number;
  consecutiveErrors: number;
}

export function validateManifest<Caps>(manifest: ProviderManifest<Caps>): void {
  if (!manifest.domain) {
    throw new Error('Manifest missing domain');
  }
  // 4.5: reject an unknown domain (e.g. a 'shortlinks' typo) — it would register
  // into an unreachable bucket and surface only as a runtime 404.
  if (!(PROVIDER_DOMAINS as readonly string[]).includes(manifest.domain)) {
    throw new Error(`Manifest invalid domain: ${JSON.stringify(manifest.domain)}`);
  }
  if (!manifest.providerId || typeof manifest.providerId !== 'string') {
    throw new Error('Manifest missing providerId');
  }
  // 4.5: providerId is a routing segment in `domain/providerId@version`; a '/',
  // '@' or whitespace breaks round-tripping the qualified id.
  if (
    manifest.providerId.includes('/') ||
    manifest.providerId.includes('@') ||
    manifest.providerId !== manifest.providerId.trim() ||
    /\s/.test(manifest.providerId)
  ) {
    throw new Error(`Manifest invalid providerId format: ${JSON.stringify(manifest.providerId)}`);
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error('Manifest missing version');
  }
  // Identity helpers qualify()/keyString()/parseQualified() use '@' and '/' as
  // separators; a version containing either (or wrapped in whitespace) breaks
  // round-tripping. Versions are otherwise free-form (date-style, channel ids, …).
  if (
    manifest.version.includes('@') ||
    manifest.version.includes('/') ||
    manifest.version !== manifest.version.trim()
  ) {
    throw new Error(`Manifest invalid version format: ${JSON.stringify(manifest.version)}`);
  }
  if (!manifest.displayName || typeof manifest.displayName !== 'string') {
    throw new Error('Manifest missing displayName');
  }
  const validStatuses: ProviderVersionStatus[] = ['preview', 'active', 'deprecated', 'retired'];
  if (!validStatuses.includes(manifest.status)) {
    throw new Error(`Manifest invalid status: ${manifest.status}`);
  }
  // PF-06: a version with a semver prerelease suffix must be registered as
  // `preview` so `latestActive` never selects a prerelease over its stable base.
  if (versionIsPrerelease(manifest.version) && manifest.status !== 'preview') {
    throw new Error(
      `Prerelease version ${manifest.version} must have status preview, got ${manifest.status}`,
    );
  }
  if (!Array.isArray(manifest.credentialFields)) {
    throw new Error('Manifest credentialFields must be an array');
  }
  if (manifest.capabilities === undefined || manifest.capabilities === null) {
    throw new Error('Manifest missing capabilities');
  }
  for (const field of manifest.credentialFields) {
    if (!field.key || typeof field.key !== 'string') {
      throw new Error('CredentialField missing key');
    }
    if (!field.label || typeof field.label !== 'string') {
      throw new Error(`CredentialField ${field.key} missing label`);
    }
    const validTypes = ['string', 'text', 'password', 'textarea', 'json', 'select'];
    if (!validTypes.includes(field.type)) {
      throw new Error(`CredentialField ${field.key} invalid type: ${field.type}`);
    }
    if (typeof field.required !== 'boolean') {
      throw new Error(`CredentialField ${field.key} missing required boolean`);
    }
  }
}

export function manifestKey(manifest: ProviderManifest): ProviderKey {
  return {
    domain: manifest.domain,
    providerId: manifest.providerId,
    version: manifest.version,
  };
}

export function manifestKeyString(manifest: ProviderManifest): string {
  return keyString(manifestKey(manifest));
}
