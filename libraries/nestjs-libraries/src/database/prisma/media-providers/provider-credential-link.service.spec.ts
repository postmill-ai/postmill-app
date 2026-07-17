import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderCredentialLinkService } from './provider-credential-link.service';

function makeService() {
  const mediaRepository = {
    upsert: vi.fn().mockResolvedValue({}),
    getByIdentifier: vi.fn().mockResolvedValue(null),
    // 1.2: the sync path reads the target row version-agnostically. Delegate to
    // getByIdentifier so per-test mocks drive both.
    findAnyByIdentifier: vi.fn((orgId: string, id: string) =>
      mediaRepository.getByIdentifier(orgId, id),
    ),
  };
  const aiRepository = {
    upsert: vi.fn().mockResolvedValue({}),
    getByIdentifier: vi.fn().mockResolvedValue(null),
    findAnyByIdentifier: vi.fn((orgId: string, id: string) =>
      aiRepository.getByIdentifier(orgId, id),
    ),
  };
  const encryption = { encrypt: vi.fn((v: string) => `enc(${v})`) };
  const resolution = { latestActiveVersion: vi.fn().mockReturnValue('v1') };
  const service = new ProviderCredentialLinkService(
    mediaRepository as never,
    aiRepository as never,
    encryption as never,
    resolution as never,
  );
  return { service, mediaRepository, aiRepository, encryption, resolution };
}

describe('ProviderCredentialLinkService (§11.4 auto-config live-link)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks only openai and minimax as linked', () => {
    const { service } = makeService();
    expect(service.isLinked('openai')).toBe(true);
    expect(service.isLinked('minimax')).toBe(true);
    expect(service.isLinked('anthropic')).toBe(false);
    expect(service.isLinked('luma')).toBe(false);
  });

  it('mirrors AI credentials onto the media config (encrypted) for linked providers', async () => {
    const { service, mediaRepository } = makeService();
    await service.syncFromAiProvider('org-1', 'openai', { apiKey: 'sk-123' });

    expect(mediaRepository.upsert).toHaveBeenCalledWith(
      'org-1',
      'openai',
      {
        enabled: true,
        credentials: `enc(${JSON.stringify({ apiKey: 'sk-123' })})`,
      },
      'v1',
    );
  });

  it('pins the mirror-target row version instead of hardcoding v1 (1.4)', async () => {
    const { service, mediaRepository, resolution } = makeService();
    // existing media row is pinned to v2 → the mirror write must target v2.
    mediaRepository.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v2', enabled: true });

    await service.syncFromAiProvider('org-1', 'openai', { apiKey: 'sk-123' });

    expect(mediaRepository.upsert).toHaveBeenCalledWith(
      'org-1',
      'openai',
      expect.objectContaining({ enabled: true }),
      'v2',
    );
    expect(resolution.latestActiveVersion).not.toHaveBeenCalled();
  });

  // 1.1(c): a re-key must NOT silently re-enable a deliberately-disabled mirror row.
  it('preserves a disabled mirror row\'s enabled flag on re-key (1.1c)', async () => {
    const { service, mediaRepository } = makeService();
    mediaRepository.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', enabled: false });

    await service.syncFromAiProvider('org-1', 'openai', { apiKey: 'sk-new' });

    expect(mediaRepository.upsert).toHaveBeenCalledWith(
      'org-1',
      'openai',
      expect.objectContaining({ enabled: false }),
      'v1',
    );
  });

  it('does not touch the media row\'s storage binding (only credentials/enabled)', async () => {
    const { service, mediaRepository } = makeService();
    await service.syncFromAiProvider('org-1', 'minimax', { apiKey: 'mm-key' });
    const data = mediaRepository.upsert.mock.calls[0][2];
    expect(Object.keys(data).sort()).toEqual(['credentials', 'enabled']);
  });

  it('mirrors media credentials onto the AI config (encrypted) for linked providers', async () => {
    const { service, aiRepository } = makeService();
    await service.syncFromMediaProvider('org-1', 'minimax', { apiKey: 'mm-key' });

    expect(aiRepository.upsert).toHaveBeenCalledWith(
      'org-1',
      'minimax',
      {
        enabled: true,
        credentials: `enc(${JSON.stringify({ apiKey: 'mm-key' })})`,
      },
      'v1',
    );
  });

  it('ignores non-linked providers in both directions', async () => {
    const { service, mediaRepository, aiRepository } = makeService();
    await service.syncFromAiProvider('org-1', 'anthropic', { apiKey: 'x' });
    await service.syncFromMediaProvider('org-1', 'heygen', { apiKey: 'x' });
    expect(mediaRepository.upsert).not.toHaveBeenCalled();
    expect(aiRepository.upsert).not.toHaveBeenCalled();
  });

  it('is non-fatal when the mirror write fails', async () => {
    const { service, mediaRepository, aiRepository } = makeService();
    mediaRepository.upsert.mockRejectedValue(new Error('db down'));
    aiRepository.upsert.mockRejectedValue(new Error('db down'));

    await expect(service.syncFromAiProvider('org-1', 'openai', { apiKey: 'k' })).resolves.toBeUndefined();
    await expect(service.syncFromMediaProvider('org-1', 'openai', { apiKey: 'k' })).resolves.toBeUndefined();
  });
});
