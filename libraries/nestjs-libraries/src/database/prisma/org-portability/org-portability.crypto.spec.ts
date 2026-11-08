import { describe, expect, it } from 'vitest';
import {
  createOrgArchiveKey,
  decryptOrgSecretRefs,
  encryptOrgSecretRefs,
  orgManifestMac,
  unwrapOrgArchiveKey,
  verifyOrgManifestMac,
  wrapOrgArchiveKey,
} from './org-portability.crypto';
import { ORG_EXPORT_SCHEMA, type OrgPortabilityManifest } from './org-portability.types';

describe('organization archive cryptography', () => {
  it('round-trips the archive key and encrypted credentials without storing the passphrase', () => {
    const archiveKey = createOrgArchiveKey();
    const keyWrap = wrapOrgArchiveKey(archiveKey, 'correct horse battery staple');
    const secrets = encryptOrgSecretRefs([
      { model: 'Integration', id: 'channel-1', field: 'token', value: 'provider-secret' },
    ], archiveKey);

    expect(JSON.stringify(keyWrap)).not.toContain('correct horse battery staple');
    expect(JSON.stringify(secrets)).not.toContain('provider-secret');
    const unwrapped = unwrapOrgArchiveKey(keyWrap, 'correct horse battery staple');
    expect(unwrapped.equals(archiveKey)).toBe(true);
    expect(decryptOrgSecretRefs(secrets, unwrapped)[0].value).toBe('provider-secret');
    expect(() => unwrapOrgArchiveKey(keyWrap, 'wrong passphrase')).toThrow();
  });

  it('authenticates the manifest and rejects modification', () => {
    const key = createOrgArchiveKey();
    const keyWrap = wrapOrgArchiveKey(key, 'manifest passphrase');
    const core: Omit<OrgPortabilityManifest, 'integrity'> = {
      schema: ORG_EXPORT_SCHEMA,
      appVersion: 'v1.4.0',
      createdAt: new Date().toISOString(),
      source: { organizationId: 'org-1', name: 'Example' },
      counts: { files: 1 },
      domains: {},
      assets: {},
      crypto: { ...keyWrap, secrets: encryptOrgSecretRefs([], key) },
    };
    const manifest: OrgPortabilityManifest = {
      ...core,
      integrity: { algorithm: 'hmac-sha256', mac: orgManifestMac(core, key) },
    };

    expect(verifyOrgManifestMac(manifest, key)).toBe(true);
    expect(verifyOrgManifestMac({ ...manifest, counts: { files: 2 } }, key)).toBe(false);
    expect(verifyOrgManifestMac(manifest, createOrgArchiveKey())).toBe(false);
  });
});
