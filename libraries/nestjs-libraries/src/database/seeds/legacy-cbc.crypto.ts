import crypto from 'crypto';

// MIGRATION-ONLY legacy AES-256-CBC reader for the "legacy secret re-encryption"
// backfill step (backfill.service.ts). The runtime crypto path
// (AuthService.fixedDecryption) is GCM-only as of v1.0.0 — this module exists
// solely so the one-time guard step can still READ pre-v1 CBC ciphertexts
// (OpenSSL EVP_BytesToKey key/IV derivation: MD5, no salt, 1 iteration) and
// rewrite them as `v2:` GCM. Delete this module together with the backfill step
// once every supported deployment has booted v1.0.0.

const algorithm = 'aes-256-cbc';
const { keyLength, ivLength } = crypto.getCipherInfo(algorithm);

// Pure-Node EVP_BytesToKey(MD5, no salt, count=1): D_i = MD5(D_{i-1} || pass),
// concatenated until key+iv bytes are covered.
function evpBytesToKey(pass: Buffer, keyLen: number, ivLen: number) {
  const blocks: Buffer[] = [];
  let prev = Buffer.alloc(0);
  let derived = 0;
  while (derived < keyLen + ivLen) {
    const hash = crypto.createHash('md5');
    hash.update(prev);
    hash.update(pass);
    prev = hash.digest();
    blocks.push(prev);
    derived += prev.length;
  }
  const material = Buffer.concat(blocks);
  return {
    key: material.subarray(0, keyLen),
    iv: material.subarray(keyLen, keyLen + ivLen),
  };
}

/** Throws when the input is not a well-formed legacy CBC ciphertext. */
export function decryptLegacyCbc(hexCiphertext: string): string {
  const pass = Buffer.from(process.env.JWT_SECRET ?? '', 'utf8');
  const { key, iv } = evpBytesToKey(pass, keyLength, ivLength);
  const decipher = crypto.createDecipheriv(algorithm, key, iv);
  const out = Buffer.concat([
    decipher.update(hexCiphertext, 'hex'),
    decipher.final(),
  ]);
  return out.toString('utf8');
}
