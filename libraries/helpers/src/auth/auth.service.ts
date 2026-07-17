import { sign, verify } from 'jsonwebtoken';
import { hashSync, compareSync } from 'bcrypt';
import crypto from 'crypto';
// @ts-ignore
import EVP_BytesToKey from 'evp_bytestokey';
const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

function deriveLegacyKeyIv(secret: string) {
  const { keyLength, ivLength } = crypto.getCipherInfo(algorithm); // 32, 16
  const pass = Buffer.isBuffer(secret) ? secret : Buffer.from(secret ?? '', 'utf8');

  // evp_bytestokey: key length in **bits**, IV length in **bytes**
  const { key, iv } = EVP_BytesToKey(pass, null, keyLength * 8, ivLength, 'md5');

  if (key.length !== keyLength || iv.length !== ivLength) {
    throw new Error(`Derived wrong sizes (key=${key.length}, iv=${iv.length})`);
  }
  return { key, iv };
}

export function decrypt_legacy_using_IV(hexCiphertext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([decipher.update(hexCiphertext, 'hex'), decipher.final()]);
  return out.toString('utf8');
}

export function encrypt_legacy_using_IV(utf8Plaintext: string) {
  const { key, iv } = deriveLegacyKeyIv(process.env.JWT_SECRET);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  const out = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  return out.toString('hex');
}

const GCM_ALGORITHM = 'aes-256-gcm';
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;
const V2_PREFIX = 'v2:';

function getEncryptionKey(): Buffer {
  if (process.env.ENCRYPTION_KEY) {
    // Accept base64 or hex; auto-detect by length
    const raw = process.env.ENCRYPTION_KEY;
    // If it's 44 chars of base64 (32 bytes encoded), decode as base64
    if (raw.length === 44 && /^[A-Za-z0-9+/=]+$/.test(raw)) {
      const buf = Buffer.from(raw, 'base64');
      if (buf.length === 32) return buf;
    }
    // Try hex (64 hex chars for 32 bytes)
    if (raw.length === 64 && /^[0-9a-fA-F]+$/.test(raw)) {
      const buf = Buffer.from(raw, 'hex');
      if (buf.length === 32) return buf;
    }
    // Fall back to deriving from the raw string
    const buf = Buffer.from(raw, 'utf8');
    if (buf.length >= 32) return buf.subarray(0, 32);
    // Pad if too short
    return crypto.createHash('sha256').update(raw).digest();
  }
  // Fall back to deriving from JWT_SECRET
  return crypto.createHash('sha256').update(process.env.JWT_SECRET || '').digest();
}

function encryptGcm(utf8Plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(GCM_ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(utf8Plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return V2_PREFIX + Buffer.concat([iv, encrypted, tag]).toString('base64');
}

function decryptGcm(stored: string): string {
  const payload = Buffer.from(stored.slice(V2_PREFIX.length), 'base64');
  const iv = payload.subarray(0, GCM_IV_LENGTH);
  const tag = payload.subarray(payload.length - GCM_TAG_LENGTH);
  const encrypted = payload.subarray(GCM_IV_LENGTH, payload.length - GCM_TAG_LENGTH);
  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(GCM_ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return out.toString('utf8');
}

export class AuthService {
  static hashPassword(password: string) {
    return hashSync(password, 12);
  }
  static comparePassword(password: string, hash: string) {
    return compareSync(password, hash);
  }
  static signJWT(value: object) {
    return sign(value, process.env.JWT_SECRET!, { expiresIn: '30d' });
  }
  static verifyJWT(token: string) {
    return verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
  }

  static fixedEncryption(value: string) {
    return encryptGcm(value);
  }

  static fixedDecryption(hash: string) {
    if (hash?.startsWith(V2_PREFIX)) {
      return decryptGcm(hash);
    }
    return decrypt_legacy_using_IV(hash);
  }

  static fixedEncryptionDeterministic(value: string) {
    return encrypt_legacy_using_IV(value);
  }
}
