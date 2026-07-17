import { EncryptionService } from './encryption.service';

// Pins current encrypt/decrypt behaviour so the C2–C4 encryption-hygiene changes can't
// silently break existing ciphertext (v2 GCM envelope + legacy CBC read-fallback).
describe('EncryptionService', () => {
  let svc: EncryptionService;

  beforeAll(() => {
    process.env.JWT_SECRET =
      process.env.JWT_SECRET || 'test-jwt-secret-for-encryption-roundtrip';
  });

  beforeEach(() => {
    svc = new EncryptionService();
  });

  it('round-trips a value through encrypt/decrypt', () => {
    const plain = 'hello-secret-123';
    const enc = svc.encrypt(plain);
    expect(enc).not.toBe(plain);
    expect(svc.decrypt(enc)).toBe(plain);
  });

  it('produces a v2: GCM envelope and decrypts it', () => {
    const enc = svc.encrypt('api-key-xyz');
    expect(enc.startsWith('v2:')).toBe(true);
    expect(svc.decrypt(enc)).toBe('api-key-xyz');
  });

  it('still decrypts a legacy (non-v2) ciphertext via the CBC fallback', () => {
    const legacy = svc.encryptDeterministic('legacy-value');
    expect(legacy.startsWith('v2:')).toBe(false);
    expect(svc.decrypt(legacy)).toBe('legacy-value');
  });

  it('round-trips a JSON credentials blob', () => {
    const blob = JSON.stringify({
      apiKey: 'sk-abc',
      region: 'us-east-1',
      nested: { a: 1 },
    });
    expect(svc.decrypt(svc.encrypt(blob))).toBe(blob);
  });
});
