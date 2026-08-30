import { EncryptionService } from './encryption.service';

// Pins current encrypt/decrypt behaviour so the C2–C4 encryption-hygiene changes can't
// silently break existing ciphertext. v1.0.0: v2 GCM envelope only — the legacy CBC
// read-fallback and the deterministic CBC writer were removed.
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

  it('refuses to decrypt a non-v2: value (legacy CBC support removed)', () => {
    expect(() => svc.decrypt('deadbeefciphertext')).toThrow(/v2:/);
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
