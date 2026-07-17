import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

const mockSafeFetch = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { ReplicateRunnerService } from './replicate-runner.service';
import { ReplicateCatalogService } from './replicate-catalog.service';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('ReplicateRunnerService', () => {
  let runner: ReplicateRunnerService;
  let mockCatalog: any;
  let mockAiSettings: any;
  let mockLifecycle: any;
  let mockStorage: any;
  let mockOrgMediaProviderSettings: any;
  let mockFileService: any;
  let mockVideoRender: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockReset();

    mockCatalog = {
      getReplicateKey: vi.fn().mockResolvedValue('test-key'),
      getModel: vi.fn().mockResolvedValue({ versionId: 'community-version' }),
    };

    mockAiSettings = {
      createMediaJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
      updateMediaJob: vi.fn().mockResolvedValue({}),
      getMediaJobById: vi.fn().mockResolvedValue(null),
    };

    mockLifecycle = {
      createPendingJob: vi.fn().mockResolvedValue({ id: 'job-1' }),
      attachProviderJob: vi.fn().mockResolvedValue(undefined),
      failJob: vi.fn().mockResolvedValue(undefined),
      webhookUrlFor: vi.fn().mockReturnValue('https://api.example.com/webhook'),
      completeJobWithBuffer: vi.fn().mockResolvedValue(true),
    };

    mockStorage = {
      resolveAdapterForFolder: vi.fn().mockResolvedValue({
        getFileUrl: vi.fn().mockReturnValue('https://public.example.com/file.png'),
        readFile: vi.fn().mockResolvedValue(Buffer.from('file')),
      }),
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        getFileUrl: vi.fn().mockReturnValue('https://local.example.com/file.png'),
        readFile: vi.fn().mockResolvedValue(Buffer.from('file')),
      }),
      assertWithinProviderQuota: vi.fn().mockResolvedValue(undefined),
    };

    mockOrgMediaProviderSettings = {};

    mockFileService = {
      getFileById: vi.fn().mockResolvedValue({
        id: 'file-1',
        path: 'uploads/file.png',
        folderId: 'folder-1',
        organizationId: 'org1',
      }),
    };

    mockVideoRender = {
      enqueueMerge: vi.fn().mockResolvedValue({ jobId: 'merge-job-1' }),
    };

    runner = new ReplicateRunnerService(
      mockCatalog as ReplicateCatalogService,
      mockAiSettings,
      mockLifecycle,
      mockStorage,
      mockOrgMediaProviderSettings,
      mockFileService,
      mockVideoRender,
    );
  });

  describe('runSync', () => {
    it('calls the official model URL without a version', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          id: 'pred-1',
          status: 'succeeded',
          output: 'https://rep/out.png',
        }),
      );

      const result = await runner.runSync('org1', '', {
        modelId: 'black-forest-labs/flux-schnell',
        input: { prompt: 'cat' },
        operation: 'image',
      });

      expect(result).toMatchObject({
        status: 'succeeded',
        kind: 'image',
        urls: ['https://rep/out.png'],
      });

      const url = mockSafeFetch.mock.calls[0][0];
      expect(url).toBe(
        'https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions',
      );
      const init = mockSafeFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body).not.toHaveProperty('version');
      expect(init.headers).toMatchObject({
        Prefer: 'wait=60',
        Authorization: 'Bearer test-key',
      });
    });

    it('does not consume platform credits for image generation (BYOK)', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          id: 'pred-1',
          status: 'starting',
        }),
      );

      const result = await runner.runSync(
        'org1',
        '',
        {
          modelId: 'black-forest-labs/flux-schnell',
          input: { prompt: 'cat' },
          operation: 'image',
        },
        { creditType: 'ai_images' },
      );

      // No subscriptionService in this service; creditType is preserved in the job row only.
      expect(result).toMatchObject({ status: 'pending', kind: 'image' });
      expect(mockAiSettings.createMediaJob).toHaveBeenCalledWith(
        expect.objectContaining({ creditType: 'ai_images' }),
      );
    });

    it('resolves fileId inputs to public https URLs', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          id: 'pred-1',
          status: 'succeeded',
          output: 'https://rep/out.png',
        }),
      );

      await runner.runSync('org1', '', {
        modelId: 'black-forest-labs/flux-schnell',
        input: { image: { fileId: 'file-1' } },
        operation: 'image',
      });

      const init = mockSafeFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.input.image).toBe('https://public.example.com/file.png');
    });

    it('throws ForbiddenException when file belongs to another org', async () => {
      mockFileService.getFileById.mockResolvedValue({
        id: 'file-1',
        path: 'uploads/file.png',
        folderId: 'folder-1',
        organizationId: 'org2',
      });

      await expect(
        runner.runSync('org1', '', {
          modelId: 'black-forest-labs/flux-schnell',
          input: { image: { fileId: 'file-1' } },
          operation: 'image',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('1.5: rejects an off-allowlist modelId with BadRequestException (no provider call)', async () => {
      await expect(
        runner.runSync('org1', '', {
          modelId: 'attacker/expensive-model',
          input: { prompt: 'cat' },
          operation: 'image',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockSafeFetch).not.toHaveBeenCalled();
    });
  });

  describe('runAsync', () => {
    it('calls the community predictions URL with a version', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({ id: 'pred-2', status: 'starting' }),
      );

      const result = await runner.runAsync(
        'org1',
        '',
        {
          modelId: 'arielreplicate/robust_video_matting',
          versionId: 'v-community',
          input: { prompt: 'cat' },
          operation: 'video',
          folderId: 'folder-1',
        },
        { creditType: 'ai_videos' },
      );

      expect(result).toEqual({ jobId: 'job-1' });
      const url = mockSafeFetch.mock.calls[0][0];
      expect(url).toBe('https://api.replicate.com/v1/predictions');
      const init = mockSafeFetch.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.version).toBe('v-community');
    });

    it('throws BadRequestException when a community model is missing a version', async () => {
      mockCatalog.getModel.mockResolvedValue({ versionId: '' });
      mockSafeFetch.mockResolvedValue(jsonResponse({}));

      await expect(
        runner.runAsync(
          'org1',
          '',
          {
            modelId: 'arielreplicate/robust_video_matting',
            input: { prompt: 'cat' },
            operation: 'video',
          },
          { creditType: 'ai_videos' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('1.5: rejects an off-allowlist modelId with BadRequestException (no provider call)', async () => {
      await expect(
        runner.runAsync(
          'org1',
          '',
          {
            modelId: 'attacker/expensive-model',
            versionId: 'v-x',
            input: { prompt: 'cat' },
            operation: 'video',
          },
          { creditType: 'ai_videos' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(mockLifecycle.createPendingJob).not.toHaveBeenCalled();
    });

    it('creates a pending job with metadata', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({ id: 'pred-3', status: 'starting' }),
      );

      await runner.runAsync(
        'org1',
        '',
        {
          modelId: 'black-forest-labs/flux-schnell',
          input: { prompt: 'cat' },
          operation: 'image',
          folderId: 'folder-1',
        },
        { creditType: 'ai_images' },
      );

      expect(mockLifecycle.createPendingJob).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org1',
          provider: 'replicate',
          operation: 'image',
          model: 'black-forest-labs/flux-schnell',
          folderId: 'folder-1',
          creditType: 'ai_images',
        }),
      );
    });
  });
});
