import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import type { OrgPortabilityManifest, OrgPortabilitySecretRef } from './org-portability.types';

const KDF = { name: 'scrypt' as const, N: 32_768, r: 8, p: 1 };
const GCM_IV_BYTES = 12;

const encrypt = (value: Buffer, key: Buffer) => {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    algorithm: 'aes-256-gcm' as const,
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
};

const decrypt = (payload: { iv: string; ciphertext: string; tag: string }, key: Buffer): Buffer => {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, 'base64')), decipher.final()]);
};

const canonicalize = (value: unknown): string => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item) || item instanceof Date || Buffer.isBuffer(item)) {
    return item;
  }
  return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
});

export const createOrgArchiveKey = () => randomBytes(32);

export const wrapOrgArchiveKey = (archiveKey: Buffer, passphrase: string) => {
  const salt = randomBytes(16);
  const wrappingKey = scryptSync(passphrase, salt, 32, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: 64 * 1024 * 1024,
  });
  return {
    kdf: { ...KDF, salt: salt.toString('base64') },
    wrappedKey: encrypt(archiveKey, wrappingKey),
  };
};

export const unwrapOrgArchiveKey = (
  crypto: Pick<OrgPortabilityManifest['crypto'], 'kdf' | 'wrappedKey'>,
  passphrase: string
): Buffer => {
  const wrappingKey = scryptSync(passphrase, Buffer.from(crypto.kdf.salt, 'base64'), 32, {
    N: crypto.kdf.N,
    r: crypto.kdf.r,
    p: crypto.kdf.p,
    maxmem: 64 * 1024 * 1024,
  });
  return decrypt(crypto.wrappedKey, wrappingKey);
};

export const encryptOrgSecretRefs = (refs: OrgPortabilitySecretRef[], archiveKey: Buffer) =>
  encrypt(Buffer.from(JSON.stringify(refs), 'utf8'), archiveKey);

export const decryptOrgSecretRefs = (
  payload: OrgPortabilityManifest['crypto']['secrets'],
  archiveKey: Buffer
): OrgPortabilitySecretRef[] => JSON.parse(decrypt(payload, archiveKey).toString('utf8'));

export const orgManifestMac = (
  manifest: Omit<OrgPortabilityManifest, 'integrity'>,
  archiveKey: Buffer
): string => createHmac('sha256', archiveKey).update(canonicalize(manifest)).digest('base64');

export const verifyOrgManifestMac = (
  manifest: OrgPortabilityManifest,
  archiveKey: Buffer
): boolean => {
  const { integrity: _integrity, ...core } = manifest;
  const expected = Buffer.from(orgManifestMac(core, archiveKey));
  const actual = Buffer.from(manifest.integrity.mac);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
