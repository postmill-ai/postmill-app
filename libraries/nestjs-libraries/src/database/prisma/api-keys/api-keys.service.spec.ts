import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as crypto from 'crypto';
import { ApiKeysService } from './api-keys.service';
import { ApiKeysRepository } from './api-keys.repository';

const sha256 = (value: string) =>
  crypto.createHash('sha256').update(value).digest('hex');

describe('ApiKeysService', () => {
  let repo: {
    create: ReturnType<typeof vi.fn>;
    listForUserOrg: ReturnType<typeof vi.fn>;
    findActiveByHash: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
    touchLastUsed: ReturnType<typeof vi.fn>;
  };
  let service: ApiKeysService;

  beforeEach(() => {
    repo = {
      create: vi.fn().mockResolvedValue({ id: 'key-1' }),
      listForUserOrg: vi.fn().mockResolvedValue([]),
      findActiveByHash: vi.fn().mockResolvedValue(null),
      revoke: vi.fn().mockResolvedValue({ id: 'key-1', revokedAt: new Date() }),
      touchLastUsed: vi.fn().mockResolvedValue({ count: 1 }),
    };
    service = new ApiKeysService(repo as unknown as ApiKeysRepository);
  });

  describe('createKey', () => {
    it('returns a pm_live_ plaintext once and stores only the sha256 hash + prefix', async () => {
      const result = await service.createKey('user-1', 'org-1', 'My key');

      expect(result.plaintext).toMatch(/^pm_live_/);
      expect(result.name).toBe('My key');

      expect(repo.create).toHaveBeenCalledTimes(1);
      const stored = repo.create.mock.calls[0][0];
      expect(stored.organizationId).toBe('org-1');
      expect(stored.userId).toBe('user-1');
      expect(stored.name).toBe('My key');
      // only the sha256 of the plaintext is persisted — never the plaintext
      expect(stored.hashedKey).toBe(sha256(result.plaintext));
      expect(stored.hashedKey).not.toBe(result.plaintext);
      expect(Object.values(stored)).not.toContain(result.plaintext);
      expect(stored).not.toHaveProperty('plaintext');
    });

    it('stores a display prefix derived from the plaintext', async () => {
      const result = await service.createKey('user-1', 'org-1', 'My key');
      const stored = repo.create.mock.calls[0][0];

      expect(stored.prefix).toBe(`pm_live_${result.plaintext.slice(8, 12)}`);
      expect(result.prefix).toBe(stored.prefix);
      // the prefix alone is not enough to reconstruct the key
      expect(stored.prefix.length).toBeLessThan(result.plaintext.length);
    });

    it('generates a unique key each call', async () => {
      const first = await service.createKey('user-1', 'org-1', 'a');
      const second = await service.createKey('user-1', 'org-1', 'b');
      expect(first.plaintext).not.toBe(second.plaintext);
    });

    it('passes expiresAt through as a Date, or null when omitted', async () => {
      await service.createKey('user-1', 'org-1', 'expiring', '2030-01-01T00:00:00.000Z');
      expect(repo.create.mock.calls[0][0].expiresAt).toEqual(
        new Date('2030-01-01T00:00:00.000Z'),
      );

      await service.createKey('user-1', 'org-1', 'forever');
      expect(repo.create.mock.calls[1][0].expiresAt).toBeNull();
    });
  });

  describe('rotateKey', () => {
    it('revokes the old key and creates a new one', async () => {
      const result = await service.rotateKey('old-key-id', 'user-1', 'org-1', 'rotated');

      expect(repo.revoke).toHaveBeenCalledWith('old-key-id', 'user-1', 'org-1');
      expect(repo.create).toHaveBeenCalledTimes(1);
      expect(result.plaintext).toMatch(/^pm_live_/);
      expect(repo.create.mock.calls[0][0].hashedKey).toBe(sha256(result.plaintext));
      // revoke happens before the new key is created
      expect(repo.revoke.mock.invocationCallOrder[0]).toBeLessThan(
        repo.create.mock.invocationCallOrder[0],
      );
    });

    it('does not create a new key when revoking the old one fails (not owned by user/org)', async () => {
      repo.revoke.mockRejectedValue(new Error('Record to update not found'));
      await expect(
        service.rotateKey('someone-elses-key', 'user-1', 'org-1', 'rotated'),
      ).rejects.toThrow();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('revokeKey', () => {
    it('revokes scoped to the requesting user and org', async () => {
      await service.revokeKey('key-1', 'user-1', 'org-1');
      expect(repo.revoke).toHaveBeenCalledWith('key-1', 'user-1', 'org-1');
    });
  });

  describe('listKeys', () => {
    it('lists only the requesting user\'s keys in the current org', async () => {
      await service.listKeys('user-1', 'org-1');
      expect(repo.listForUserOrg).toHaveBeenCalledWith('user-1', 'org-1');
    });
  });

  describe('findActiveByHash', () => {
    it('returns the active key for a hash', async () => {
      const active = { id: 'key-1', revokedAt: null, expiresAt: null };
      repo.findActiveByHash.mockResolvedValue(active);

      const result = await service.findActiveByHash('some-hash');
      expect(repo.findActiveByHash).toHaveBeenCalledWith('some-hash');
      expect(result).toBe(active);
    });

    it('returns null for revoked/expired keys (repository filters them out)', async () => {
      // revoked/expired filtering lives in the repository's findActiveByHash
      // where clause; the service contract is simply: filtered key → null.
      repo.findActiveByHash.mockResolvedValue(null);
      await expect(service.findActiveByHash('revoked-or-expired')).resolves.toBeNull();
    });
  });

  describe('touchLastUsed', () => {
    it('delegates to the repository scoped by org', async () => {
      await service.touchLastUsed('key-1', 'org-1');
      expect(repo.touchLastUsed).toHaveBeenCalledWith('key-1', 'org-1');
    });
  });
});
