import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository', () => ({
  AutopostRepository: class {
    getAutoposts = vi.fn();
    createAutopost = vi.fn().mockResolvedValue({ id: 'ap-1' });
    changeActive = vi.fn().mockResolvedValue({ id: 'ap-1' });
    deleteAutopost = vi.fn().mockResolvedValue({ id: 'ap-1' });
    getAutopost = vi.fn();
    updateUrl = vi.fn();
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {
    getIntegrationsList = vi.fn().mockResolvedValue([]);
    getIntegrationById = vi.fn();
    getPlugs = vi.fn();
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {
    findFreeDateTime = vi.fn().mockResolvedValue('2026-01-01T12:00:00');
    createPost = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    langchainModel = vi.fn();
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/media.service', () => ({
  AiMediaService: class {
    generateImage = vi.fn();
  },
}));

vi.mock('@gitroom/nestjs-libraries/inngest/inngest.client', () => ({
  inngest: { send: vi.fn() },
  isInngestEnabled: vi.fn().mockReturnValue(true),
}));

const { parseStringMock, parseURLMock, safeFetchMock } = vi.hoisted(() => ({
  parseStringMock: vi.fn(),
  parseURLMock: vi.fn(),
  safeFetchMock: vi.fn(),
}));
vi.mock('rss-parser', () => ({
  default: class {
    parseString = parseStringMock;
    parseURL = parseURLMock;
  },
}));
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (...args: any[]) => safeFetchMock(...args),
}));

import { AutopostService } from './autopost.service';
import {
  inngest,
  isInngestEnabled,
} from '@gitroom/nestjs-libraries/inngest/inngest.client';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';

describe('AutopostService.processCron Inngest dispatch', () => {
  let service: AutopostService;

  beforeEach(() => {
    vi.mocked(isInngestEnabled).mockReturnValue(true);
    vi.clearAllMocks();
    vi.mocked(inngest.send).mockResolvedValue(undefined);

    service = new AutopostService(
      new AutopostRepository(),
      new IntegrationService(),
      new PostsService(),
      new AIModelProvider(),
      new AiMediaService()
    );
  });

  it('sends autopost/process when active and Inngest is enabled with a per-activation unique id', async () => {
    await service.processCron(true, 'org-1', 'ap-1');

    expect(inngest.send).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'autopost/process',
        data: { id: 'ap-1', organizationId: 'org-1' },
        // 0.9: id is unique per activation (timestamp-suffixed), no longer the
        // constant `autopost-ap-1` that would be deduped across re-activations.
        id: expect.stringMatching(/^autopost-ap-1-\d+$/),
      })
    );
  });

  it('varies the activation id across successive activations (0.9)', async () => {
    const nowSpy = vi.spyOn(Date, 'now');
    nowSpy.mockReturnValueOnce(1000).mockReturnValueOnce(2000);

    await service.processCron(true, 'org-1', 'ap-1');
    await service.processCron(true, 'org-1', 'ap-1');

    const first = vi.mocked(inngest.send).mock.calls[0][0] as any;
    const second = vi.mocked(inngest.send).mock.calls[1][0] as any;
    expect(first.id).not.toBe(second.id);

    nowSpy.mockRestore();
  });

  it('sends autopost/cancel when inactive and Inngest is enabled', async () => {
    await service.processCron(false, 'org-1', 'ap-1');

    expect(inngest.send).toHaveBeenCalledWith({
      name: 'autopost/cancel',
      data: { id: 'ap-1' },
    });
  });

  it('skips autopost/process when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);

    await service.processCron(true, 'org-1', 'ap-1');

    expect(inngest.send).not.toHaveBeenCalled();
  });

  it('skips autopost/cancel when Inngest is disabled', async () => {
    vi.mocked(isInngestEnabled).mockReturnValue(false);

    const result = await service.processCron(false, 'org-1', 'ap-1');

    expect(inngest.send).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });
});

describe('AutopostService.loadXML SSRF-safe RSS fetch (0.6)', () => {
  let service: AutopostService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutopostService(
      new AutopostRepository(),
      new IntegrationService(),
      new PostsService(),
      new AIModelProvider(),
      new AiMediaService()
    );
  });

  it('fetches the feed through safeFetch and parses via parseString, not parseURL', async () => {
    safeFetchMock.mockResolvedValue({
      text: vi.fn().mockResolvedValue('<rss>xml</rss>'),
    });
    parseStringMock.mockResolvedValue({
      items: [
        {
          pubDate: '2026-01-02T00:00:00Z',
          link: 'https://example.com/post',
          description: 'hello',
        },
      ],
    });

    const result = await service.loadXML('https://example.com/feed.xml');

    expect(safeFetchMock).toHaveBeenCalledWith('https://example.com/feed.xml');
    expect(parseStringMock).toHaveBeenCalledWith('<rss>xml</rss>');
    expect(parseURLMock).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
    expect(result.url).toBe('https://example.com/post');
  });

  it('returns { success: false } when safeFetch rejects (e.g. private-IP rebinding)', async () => {
    safeFetchMock.mockRejectedValue(new Error('blocked: private address'));

    const result = await service.loadXML('http://169.254.169.254/feed');

    expect(parseStringMock).not.toHaveBeenCalled();
    expect(result).toEqual({ success: false });
  });
});
