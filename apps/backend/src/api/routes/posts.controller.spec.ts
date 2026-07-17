import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class MockPostsService {},
}));

vi.mock('@gitroom/nestjs-libraries/agent/agent.graph.service', () => ({
  AgentGraphService: class MockAgentGraphService {},
}));

vi.mock('@gitroom/nestjs-libraries/short-linking/short.link.service', () => ({
  ShortLinkService: class MockShortLinkService {
    shouldShortlink = vi.fn();
  },
}));

import { PostsController } from './posts.controller';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';

describe('PostsController', () => {
  let controller: PostsController;
  let shortLinkService: ShortLinkService;

  beforeEach(() => {
    vi.clearAllMocks();
    shortLinkService = new (ShortLinkService as any)();
    controller = new PostsController(
      {} as PostsService,
      {} as AgentGraphService,
      shortLinkService,
    );
  });

  describe('shouldShortlink', () => {
    it('returns enriched response including provider name and domain', async () => {
      const org = { id: 'org-1' } as any;
      const body = { messages: ['check https://example.com'] };
      vi.mocked(shortLinkService.shouldShortlink).mockResolvedValue({
        ask: true,
        providerName: 'Bitly',
        domain: 'bit.ly',
      });

      const result = await controller.shouldShortlink(org, body);

      expect(shortLinkService.shouldShortlink).toHaveBeenCalledWith('org-1', body.messages);
      expect(result).toEqual({
        ask: true,
        providerName: 'Bitly',
        domain: 'bit.ly',
      });
    });

    it('returns ask:false when no provider or urls', async () => {
      const org = { id: 'org-1' } as any;
      const body = { messages: ['no urls here'] };
      vi.mocked(shortLinkService.shouldShortlink).mockResolvedValue({ ask: false });

      const result = await controller.shouldShortlink(org, body);

      expect(result).toEqual({ ask: false });
    });
  });
});
