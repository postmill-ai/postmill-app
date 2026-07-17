import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepgramService } from './deepgram.service';

function makeService() {
  const orgMediaProviderSettings = {
    getConfigForProvider: vi.fn().mockResolvedValue({ credentials: { apiKey: 'k' }, version: 'v1' }),
  };
  const lifecycle = { createPendingJob: vi.fn(), completeJobWithBuffer: vi.fn() };
  const aiSettings = { getMediaJobById: vi.fn() };
  const readFile = vi.fn().mockResolvedValue(Buffer.from('audio-bytes'));
  const storageAdapter = { readFile };
  const storage = {
    resolveAdapterForFolder: vi.fn().mockResolvedValue(storageAdapter),
    getLocalAdapterForOrg: vi.fn().mockResolvedValue(storageAdapter),
  };
  const fileService = { getFileById: vi.fn() };
  const speechToTextWords = vi.fn().mockResolvedValue({ text: 'hello world', words: [] });
  const resolution = { resolveMedia: vi.fn().mockReturnValue({ speechToTextWords }) };

  const service = new DeepgramService(
    orgMediaProviderSettings as never,
    lifecycle as never,
    aiSettings as never,
    storage as never,
    fileService as never,
    resolution as never,
  );
  return { service, fileService, readFile, speechToTextWords };
}

describe('DeepgramService transcription source size ceiling (§6.2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a source whose stored size exceeds 250 MB before reading any bytes', async () => {
    const { service, fileService, readFile } = makeService();
    fileService.getFileById.mockResolvedValue({
      id: 'f1',
      organizationId: 'org-1',
      path: 'a.mp3',
      fileSize: 300 * 1024 * 1024,
      folderId: null,
    });

    await expect(service.transcribe('org-1', { fileId: 'f1' })).rejects.toThrow('too large');
    expect(readFile).not.toHaveBeenCalled();
  });

  it('backstops on the real byte length when the stored size is stale (0)', async () => {
    const { service, fileService, readFile } = makeService();
    fileService.getFileById.mockResolvedValue({
      id: 'f1',
      organizationId: 'org-1',
      path: 'a.mp3',
      fileSize: 0,
      folderId: null,
    });
    // fake an oversized buffer by length only — the code throws on buffer.length before use.
    readFile.mockResolvedValue({ length: 260 * 1024 * 1024 } as unknown as Buffer);

    await expect(service.transcribe('org-1', { fileId: 'f1' })).rejects.toThrow('too large');
  });

  it('transcribes a normal-sized source', async () => {
    const { service, fileService, speechToTextWords } = makeService();
    fileService.getFileById.mockResolvedValue({
      id: 'f1',
      organizationId: 'org-1',
      path: 'a.mp3',
      fileSize: 1024,
      folderId: null,
    });

    const result = await service.transcribe('org-1', { fileId: 'f1', model: 'nova-2' });

    expect(speechToTextWords).toHaveBeenCalled();
    expect(result.text).toBe('hello world');
  });
});
