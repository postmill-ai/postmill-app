import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLangchainModel = {
  withStructuredOutput: vi.fn().mockReturnValue({}),
  bindTools: vi.fn().mockReturnValue({}),
};

const mockDoGenerate = vi.fn().mockResolvedValue({
  text: 'Mocked structured output',
  usage: { promptTokens: 10, completionTokens: 5 },
});

const mockLanguageModel = {
  modelId: 'gpt-4.1',
  doGenerate: mockDoGenerate,
};

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    langchainModel = vi.fn().mockResolvedValue(mockLangchainModel);
    imageModel = vi.fn().mockResolvedValue({
      generate: vi.fn().mockResolvedValue('https://cdn.example.com/agent-image.png'),
    });
    languageModel = vi.fn().mockResolvedValue(mockLanguageModel);
    resolveConfigForScope = vi
      .fn()
      .mockResolvedValue({ providerId: 'openai', modelId: 'gpt-x' });
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({
  PostsService: class {
    findAllExistingCategories = vi.fn().mockResolvedValue([{ category: 'Tech' }, { category: 'Business' }]);
    findAllExistingTopicsOfCategory = vi.fn().mockResolvedValue([{ topic: 'AI' }, { topic: 'Cloud' }]);
    findPopularPosts = vi.fn().mockResolvedValue([{ content: 'Popular post', hook: 'A great hook' }]);
    findFreeDateTime = vi.fn().mockResolvedValue(new Date('2026-06-10T09:00:00Z'));
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/file/file.service', () => ({
  FileService: class {
    saveFile = vi.fn().mockResolvedValue('uploaded-file-id-123');
  },
}));

const { mockUploadAdapter } = vi.hoisted(() => ({
  mockUploadAdapter: {
    uploadSimple: vi.fn().mockResolvedValue('https://storage.example.com/uploaded.png'),
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: class {
    getLocalAdapterForOrg = vi.fn().mockResolvedValue(mockUploadAdapter);
  },
}));

vi.mock('@langchain/core/messages', () => ({
  BaseMessage: class {},
  HumanMessage: class {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
  },
  ToolMessage: class {
    content: string;
    constructor(content: string) {
      this.content = content;
    }
  },
}));

vi.mock('@langchain/core/prompts', () => ({
  ChatPromptTemplate: {
    fromTemplate: vi.fn().mockReturnValue({
      pipe: vi.fn().mockReturnValue({
        pipe: vi.fn().mockReturnValue({
          invoke: vi.fn().mockResolvedValue({}),
        }),
        invoke: vi.fn().mockResolvedValue({}),
      }),
    }),
  },
}));

vi.mock('@langchain/langgraph', () => ({
  END: '__end__',
  START: '__start__',
  StateGraph: class {
    private nodes: Map<string, any> = new Map();
    private edges: Map<string, string> = new Map();
    addNode(name: string, fn: any) {
      this.nodes.set(name, fn);
      return this;
    }
    addEdge(from: string, to: string) {
      this.edges.set(from, to);
      return this;
    }
    addConditionalEdges(from: string, fn: any) {
      this.edges.set(from, fn);
      return this;
    }
    compile() {
      return {
        streamEvents: vi.fn().mockResolvedValue([]),
      };
    }
  },
}));

vi.mock('@langchain/langgraph/prebuilt', () => ({
  ToolNode: class {},
}));

vi.mock('@langchain/tavily', () => ({
  TavilySearch: class {},
}));

vi.mock('dayjs', () => {
  const actualDayjs = vi.importActual('dayjs');
  return {
    default: () => ({
      format: () => '2026-06-05T12:00:00.000Z',
    }),
  };
});

import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { AgentGraphService } from './agent.graph.service';
import type { AiMediaService } from '@gitroom/nestjs-libraries/ai/governance/media.service';

describe('AgentGraphService', () => {
  let service: AgentGraphService;
  let aiModelProvider: AIModelProvider;
  let postsService: PostsService;
  let fileService: FileService;
  let storageService: StorageService;
  let aiMediaService: { generateImage: ReturnType<typeof vi.fn> };
  let budget: { checkBudget: ReturnType<typeof vi.fn>; recordSpend: ReturnType<typeof vi.fn> };
  let guardrails: { checkOutput: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    postsService = new (PostsService as any)();
    fileService = new (FileService as any)();
    aiModelProvider = new (AIModelProvider as any)();
    storageService = new (StorageService as any)();
    aiMediaService = {
      generateImage: vi.fn().mockResolvedValue('https://cdn.example.com/agent-image.png'),
    };
    budget = {
      checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
      recordSpend: vi.fn().mockResolvedValue(undefined),
    };
    guardrails = {
      checkOutput: vi.fn().mockImplementation((c: string) => Promise.resolve(c)),
    };
    service = new AgentGraphService(
      postsService,
      fileService,
      aiModelProvider,
      storageService,
      aiMediaService as unknown as AiMediaService,
      budget as any,
      guardrails as any,
    );
  });

  describe('constructor', () => {
    it('injects AIModelProvider, PostsService, and FileService', () => {
      expect((service as any)._aiModelProvider).toBe(aiModelProvider);
      expect((service as any)._postsService).toBe(postsService);
      expect((service as any)._fileService).toBe(fileService);
    });

    it('injects StorageService', () => {
      expect((service as any)._storageService).toBe(storageService);
    });
  });

  describe('_getModel', () => {
    it('calls langchainModel with scope "generator" and orgId', async () => {
      await (service as any)._getModel('org-123');

      expect(aiModelProvider.langchainModel).toHaveBeenCalledWith('generator', 'org-123');
    });

    it('returns the langchain model from the provider', async () => {
      const model = await (service as any)._getModel('org-456');

      expect(model).toBe(mockLangchainModel);
    });
  });

  describe('generatePictures (§10.3 — routed through the media surface)', () => {
    it('calls AiMediaService.generateImage with the prompt and orgId', async () => {
      const state = {
        isPicture: true,
        orgId: 'org-1',
        content: [{ prompt: 'A scenic landscape at sunset' }],
      } as any;

      const result = await service.generatePictures(state);

      expect(aiMediaService.generateImage).toHaveBeenCalledWith(
        'A scenic landscape at sunset',
        { orgId: 'org-1' },
      );
      expect(result.content[0].image).toBe('https://cdn.example.com/agent-image.png');
    });

    it('returns unchanged state when isPicture is false', async () => {
      const state = {
        isPicture: false,
        orgId: 'org-2',
        content: [{ prompt: 'some prompt' }],
      } as any;

      const result = await service.generatePictures(state);

      expect(aiMediaService.generateImage).not.toHaveBeenCalled();
      expect(result).toEqual({});
    });

    it('caps the image fan-out at 10 items (bounds model-driven spend)', async () => {
      const state = {
        isPicture: true,
        orgId: 'org-cap',
        content: Array.from({ length: 15 }, (_, i) => ({ prompt: `p${i}` })),
      } as any;

      const result = await service.generatePictures(state);

      expect(aiMediaService.generateImage).toHaveBeenCalledTimes(10);
      expect(result.content).toHaveLength(10);
    });

    it('handles image generation failure gracefully', async () => {
      const failingMedia = {
        generateImage: vi.fn().mockRejectedValue(new Error('Image gen failed')),
      };
      const svc = new AgentGraphService(
        postsService,
        fileService,
        aiModelProvider,
        storageService,
        failingMedia as unknown as AiMediaService,
        budget as any,
        guardrails as any,
      );

      const state = {
        isPicture: true,
        orgId: 'org-3',
        content: [{ prompt: 'will fail' }, { prompt: 'second' }],
      } as any;

      const result = await svc.generatePictures(state);

      expect(result.content[0].image).toBeUndefined();
    });
  });

  describe('start', () => {
    const body = {
      research: 'Write about AI trends',
      isPicture: false,
      format: 'one_short' as const,
      tone: 'company' as const,
    };

    it('creates a graph invocation with streamEvents', async () => {
      const result = await service.start('org-99', body);

      expect(budget.checkBudget).toHaveBeenCalledWith('agent', 'org-99');
      expect(Array.isArray(result)).toBe(true);
    });

    it('rejects up-front when the org budget is exceeded, before any model call', async () => {
      budget.checkBudget.mockResolvedValueOnce({ allowed: false, reason: 'Daily cap reached' });

      await expect(service.start('org-broke', body)).rejects.toThrow('Daily cap reached');
      expect(aiModelProvider.langchainModel).not.toHaveBeenCalled();
    });

    it('builds the full graph with all nodes', () => {
      const state = AgentGraphService.state();

      expect(state).toBeDefined();
    });
  });

  describe('state machine', () => {
    it('state() returns a graph with channels configuration', () => {
      const state = AgentGraphService.state();

      expect(state).toBeDefined();
    });
  });

  describe('findCategories', () => {
    it('fetches existing categories and calls _getModel', async () => {
      const state = { fresearch: 'AI research text', orgId: 'org-1', messages: [] } as any;

      const result = await service.findCategories(state);

      expect(postsService.findAllExistingCategories).toHaveBeenCalled();
      expect(aiModelProvider.langchainModel).toHaveBeenCalledWith('generator', 'org-1');
    });
  });

  describe('findPopularPosts', () => {
    it('fetches popular posts based on category and topic', async () => {
      const state = {
        category: 'Tech',
        topic: 'AI',
        orgId: 'org-1',
      } as any;

      const result = await service.findPopularPosts(state);

      expect(postsService.findPopularPosts).toHaveBeenCalledWith('Tech', 'AI');
      expect(result.popularPosts).toBeDefined();
    });
  });

  describe('uploadPictures', () => {
    it('uploads images and calls fileService.saveFile', async () => {
      const state = {
        orgId: 'org-1',
        content: [{ image: 'https://cdn.example.com/img.png' }],
      } as any;

      const result = await service.uploadPictures(state);

      expect(mockUploadAdapter.uploadSimple).toHaveBeenCalledWith('https://cdn.example.com/img.png');
      expect(fileService.saveFile).toHaveBeenCalledWith(
        'org-1',
        'uploaded.png',
        'https://storage.example.com/uploaded.png',
      );
      expect(result.content[0].image).toBe('uploaded-file-id-123');
    });

    it('skips entries without an image', async () => {
      const state = {
        orgId: 'org-2',
        content: [{ noImage: true }],
      } as any;

      const result = await service.uploadPictures(state);

      expect(mockUploadAdapter.uploadSimple).not.toHaveBeenCalled();
      expect(result.content[0].image).toBeUndefined();
    });

    it('handles upload errors gracefully', async () => {
      mockUploadAdapter.uploadSimple.mockRejectedValueOnce(new Error('Upload failed'));

      const state = {
        orgId: 'org-3',
        content: [{ image: 'bad-url' }],
      } as any;

      const result = await service.uploadPictures(state);

      expect(result.content[0].image).toBe('bad-url');
    });
  });

  describe('fixArray', () => {
    it('wraps single content in array for one_short format', async () => {
      const state = {
        format: 'one_short',
        content: { content: 'Single post' },
      } as any;

      const result = await service.fixArray(state);

      expect(result.content).toEqual([{ content: 'Single post' }]);
    });

    it('wraps single content in array for one_long format', async () => {
      const state = {
        format: 'one_long',
        content: { content: 'Long post' },
      } as any;

      const result = await service.fixArray(state);

      expect(result.content).toEqual([{ content: 'Long post' }]);
    });

    it('returns empty object for thread formats', async () => {
      const state = {
        format: 'thread_short',
        content: [{ content: 'Post 1' }, { content: 'Post 2' }],
      } as any;

      const result = await service.fixArray(state);

      expect(result).toEqual({});
    });
  });

  describe('isGeneratePicture', () => {
    it('returns "generate-picture" when isPicture is true', async () => {
      const state = { isPicture: true, orgId: 'org-1' } as any;

      const result = await service.isGeneratePicture(state);

      expect(result).toBe('generate-picture');
    });

    it('returns "post-time" when isPicture is false', async () => {
      const state = { isPicture: false, orgId: 'org-1' } as any;

      const result = await service.isGeneratePicture(state);

      expect(result).toBe('post-time');
    });
  });

  describe('postDateTime', () => {
    it('calls postsService.findFreeDateTime with orgId', async () => {
      const state = { orgId: 'org-42' } as any;

      const result = await service.postDateTime(state);

      expect(postsService.findFreeDateTime).toHaveBeenCalledWith('org-42');
      expect(result.date).toBeInstanceOf(Date);
    });
  });

  // 1.2 — real spend attribution + one coherent 'agent' scope.
  describe('spend attribution (1.2)', () => {
    it('records spend under the real provider/model and scope "agent"', async () => {
      const cb = (service as any)._spendCallback('org-x', {
        providerId: 'openai',
        modelId: 'gpt-x',
      });
      await cb.handleLLMEnd({
        llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 5 } },
      });

      expect(budget.recordSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-x',
          provider: 'openai',
          model: 'gpt-x',
          scope: 'agent',
          inputTokens: 10,
          outputTokens: 5,
          costUsd: 0,
        })
      );
    });

    it('falls back to the "generator" sentinel when attribution is absent', async () => {
      const cb = (service as any)._spendCallback('org-y');
      await cb.handleLLMEnd({
        llmOutput: { usage: { input_tokens: 3, output_tokens: 2 } },
      });

      expect(budget.recordSpend).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'generator',
          model: 'generator',
          scope: 'agent',
        })
      );
    });

    it('resolves attribution once via resolveConfigForScope in start()', async () => {
      await service.start('org-99', {
        research: 'x',
        isPicture: false,
        format: 'one_short',
        tone: 'company',
      } as any);

      expect(aiModelProvider.resolveConfigForScope).toHaveBeenCalledWith(
        'generator',
        'org-99'
      );
    });
  });

  // 2.1 — output guardrail redaction return value is applied, not discarded.
  describe('guardrail redaction (2.1)', () => {
    it('applies redacted content back onto every generated item', async () => {
      guardrails.checkOutput.mockResolvedValue('[REDACTED]');
      const invoke = vi.fn().mockResolvedValue({
        content: [{ content: 'raw pii' }, { content: 'more pii' }],
      });
      (ChatPromptTemplate.fromTemplate as any).mockReturnValueOnce({
        pipe: () => ({ invoke }),
      });

      const state = {
        orgId: 'o',
        isPicture: false,
        format: 'thread_short',
        tone: 'company',
        hook: 'h',
        messages: [{ content: 'req' }],
        fresearch: '',
      } as any;

      const result = await service.generateContent(state);

      expect(result.content[0].content).toBe('[REDACTED]');
      expect(result.content[1].content).toBe('[REDACTED]');
    });

    it('applies redaction to the generated hook', async () => {
      guardrails.checkOutput.mockResolvedValue('[REDACTED-HOOK]');
      const invoke = vi.fn().mockResolvedValue({ hook: 'raw hook' });
      (ChatPromptTemplate.fromTemplate as any).mockReturnValueOnce({
        pipe: () => ({ invoke }),
      });

      const state = {
        orgId: 'o',
        tone: 'company',
        popularPosts: [{ hook: 'x' }],
        messages: [{ content: 'req' }],
        fresearch: '',
      } as any;

      const result = await service.generateHook(state);

      expect(result.hook).toBe('[REDACTED-HOOK]');
    });

    it('block-mode: a throwing checkOutput aborts generateContent', async () => {
      guardrails.checkOutput.mockRejectedValueOnce(new Error('blocked by policy'));
      const invoke = vi.fn().mockResolvedValue({ content: { content: 'bad' } });
      (ChatPromptTemplate.fromTemplate as any).mockReturnValueOnce({
        pipe: () => ({ invoke }),
      });

      const state = {
        orgId: 'o',
        isPicture: false,
        format: 'one_short',
        tone: 'company',
        hook: 'h',
        messages: [{ content: 'req' }],
        fresearch: '',
      } as any;

      await expect(service.generateContent(state)).rejects.toThrow('blocked by policy');
    });
  });
});
