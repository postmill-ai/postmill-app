import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDoGenerate = vi.fn().mockResolvedValue({ text: 'generated' });
const mockDoStream = vi.fn().mockResolvedValue({ stream: new ReadableStream() });
const mockGovernedLanguageModelFn = vi.fn().mockResolvedValue({
  id: 'agent-model',
  doGenerate: mockDoGenerate,
  doStream: mockDoStream,
});

const mockModuleRefGet = vi.fn();

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    governedLanguageModel = mockGovernedLanguageModelFn;
  },
}));

vi.mock('@mastra/core/agent', () => ({
  Agent: class {
    id: string;
    name: string;
    description: string;
    instructions: any;
    model: any;
    tools: any;
    memory: any;
    agents: any;

    constructor(config: any) {
      this.id = config.id;
      this.name = config.name;
      this.description = config.description;
      this.instructions = config.instructions;
      this.model = config.model;
      this.tools = config.tools;
      this.memory = config.memory;
      this.agents = config.agents;
    }
  },
}));

vi.mock('@mastra/memory', () => ({
  Memory: class {
    storage: any;
    options: any;

    constructor(config: any) {
      this.storage = config.storage;
      this.options = config.options;
    }
  },
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { _type: 'mastra.pg.store' },
}));

vi.mock('@nestjs/core', () => ({
  ModuleRef: class {
    get = mockModuleRefGet;
  },
}));

vi.mock('@gitroom/nestjs-libraries/chat/tools/tool.list', () => ({
  toolList: [],
}));

vi.mock('@gitroom/nestjs-libraries/brands/brands.service', () => ({
  BrandsService: class {
    getDefaultBrand = vi.fn().mockResolvedValue(null);
  },
}));

vi.mock('dayjs', () => {
  const actualDayjs = vi.importActual('dayjs');
  return {
    default: () => ({
      format: () => '2026-06-05 12:00:00',
    }),
  };
});

import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { pStore } from '@gitroom/nestjs-libraries/chat/mastra.store';
import { ModuleRef } from '@nestjs/core';
import { LoadToolsService, AgentState } from './load.tools.service';
import { ToolFirewallService } from '@gitroom/nestjs-libraries/ai/governance/tool-firewall.service';
import { toolList as mockToolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { BrandsService } from '@gitroom/nestjs-libraries/brands/brands.service';
import { ContentAgentBuilder, CONTENT_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/content.agent';
import { MediaAgentBuilder, MEDIA_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/media.agent';
import { AnalyticsAgentBuilder, ANALYTICS_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/analytics.agent';
import { OpsAgentBuilder, OPS_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/ops.agent';
import { SUPERVISOR_TOOL_NAMES } from './load.tools.service';

describe('LoadToolsService', () => {
  let service: LoadToolsService;
  let aiModelProvider: AIModelProvider;
  let brandsService: BrandsService;
  let contentBuilder: ContentAgentBuilder;
  let mediaBuilder: MediaAgentBuilder;
  let analyticsBuilder: AnalyticsAgentBuilder;
  let opsBuilder: OpsAgentBuilder;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_SUPERVISOR_ENABLED = 'false';
    aiModelProvider = new (AIModelProvider as any)();
    brandsService = new (BrandsService as any)();
    contentBuilder = new (ContentAgentBuilder as any)(aiModelProvider);
    mediaBuilder = new (MediaAgentBuilder as any)(aiModelProvider);
    analyticsBuilder = new (AnalyticsAgentBuilder as any)(aiModelProvider);
    opsBuilder = new (OpsAgentBuilder as any)(aiModelProvider);
    service = new LoadToolsService(
      new (ModuleRef as any)(),
      aiModelProvider,
      new ToolFirewallService(),
      brandsService,
      contentBuilder,
      mediaBuilder,
      analyticsBuilder,
      opsBuilder,
    );
  });

  describe('loadTools', () => {
    it('returns an empty object when toolList is empty', async () => {
      (mockToolList as any).length = 0;

      const result = await service.loadTools();

      expect(result).toEqual({});
    });

    it('loads tools from ModuleRef using toolList entries', async () => {
      const mockTool = { doSomething: vi.fn().mockResolvedValue('done') };
      mockModuleRefGet.mockReturnValueOnce({
        name: 'testTool',
        run: vi.fn().mockResolvedValue(mockTool),
      });

      (mockToolList as any).length = 0;
      (mockToolList as any).push({ _type: 'ToolClass' });

      const result = await service.loadTools();

      expect(mockModuleRefGet).toHaveBeenCalledTimes(1);
      expect(mockModuleRefGet).toHaveBeenCalledWith(
        { _type: 'ToolClass' },
        { strict: false },
      );
      expect(result).toEqual({ testTool: mockTool });
    });

    it('loads multiple tools and reduces them into a single object', async () => {
      const mockToolA = { a: vi.fn().mockResolvedValue('a') };
      const mockToolB = { b: vi.fn().mockResolvedValue('b') };

      mockModuleRefGet
        .mockReturnValueOnce({
          name: 'toolA',
          run: vi.fn().mockResolvedValue(mockToolA),
        })
        .mockReturnValueOnce({
          name: 'toolB',
          run: vi.fn().mockResolvedValue(mockToolB),
        });

      (mockToolList as any).length = 0;
      (mockToolList as any).push('ToolA', 'ToolB');

      const result = await service.loadTools();

      expect(mockModuleRefGet).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        toolA: mockToolA,
        toolB: mockToolB,
      });
    });
  });

  describe('agent', () => {
    it('calls loadTools internally', async () => {
      const spy = vi.spyOn(service, 'loadTools').mockResolvedValue({});

      await service.agent();

      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('creates an Agent with id "postmill"', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(agent).toBeInstanceOf(Agent as any);
      expect(agent.id).toBe('postmill');
    });

    it('creates an Agent with name "postmill" and correct description', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(agent.name).toBe('postmill');
      expect(agent.description).toBe(
        'Agent that helps manage and schedule social media posts for users',
      );
    });

    it('passes tools to the Agent constructor', async () => {
      const mockTools = { schemaTool: vi.fn(), scheduleTool: vi.fn() };
      vi.spyOn(service, 'loadTools').mockResolvedValue(mockTools);

      const agent = await service.agent();

      expect(agent.tools).toBe(mockTools);
    });

    it('creates a Memory with pStore as storage', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(agent.memory).toBeInstanceOf(Memory as any);
      expect(agent.memory.storage).toBe(pStore);
    });

    it('configures Memory with generateTitle and workingMemory options', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(agent.memory.options).toEqual({
        generateTitle: true,
        workingMemory: {
          enabled: true,
          schema: AgentState,
        },
      });
    });

    it('passes a function-form model that calls governedLanguageModel("agent")', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(typeof agent.model).toBe('function');

      const result = await agent.model();

      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledWith('agent', undefined);
      expect(result).toEqual({
        id: 'agent-model',
        doGenerate: expect.any(Function),
        doStream: expect.any(Function),
      });
    });

    it('calls governedLanguageModel with "agent" scope on each invocation', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});
      mockGovernedLanguageModelFn.mockClear();

      const agent = await service.agent();

      await agent.model();
      await agent.model();

      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledTimes(2);
      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledWith('agent', undefined);
    });

    it('passes organization id from request context to the governed model resolver', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});
      mockGovernedLanguageModelFn.mockClear();

      const agent = await service.agent();
      const requestContext = new Map();
      requestContext.set('organization', JSON.stringify({ id: 'org-123' }));

      await agent.model({ requestContext });

      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledWith('agent', 'org-123');
    });

    it('preserves the governed model doGenerate/doStream contract for Mastra', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const model = await agent.model();

      expect(typeof model.doGenerate).toBe('function');
      expect(typeof model.doStream).toBe('function');

      const result = await model.doGenerate({ prompt: 'hi' });
      expect(mockDoGenerate).toHaveBeenCalledWith({ prompt: 'hi' });
      expect(result).toEqual({ text: 'generated' });
    });

    it('has an instructions property that is a function', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();

      expect(typeof agent.instructions).toBe('function');
    });

    it('instructions function returns a string containing agent summary', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('ui', null);

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(typeof instructions).toBe('string');
      expect(instructions).toContain('You are an agent that helps manage and schedule social media posts for users');
      expect(instructions).toContain('2026-06-05 12:00:00');
    });

    it('instructions function includes confirmation guidance', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('ui', 'frontend');

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(instructions).toContain('When ui mode is true, ask for explicit user confirmation before outward actions');
      expect(instructions).toContain('If the user confirms scheduling, ask whether they want a populated modal first or to schedule immediately.');
    });

    it('instructions function appends current view preamble when ag-ui context is present', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set(
        'ag-ui',
        JSON.stringify({
          view: 'launches',
          calendarWeek: '2026-06-01/2026-06-07',
          visiblePostIds: ['post-1', 'post-2'],
          selectedCampaignId: 'campaign-1',
          currentPostId: 'post-1',
        })
      );

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(instructions).toContain('The user is currently viewing:');
      expect(instructions).toContain('view: launches');
      expect(instructions).toContain('calendarWeek: 2026-06-01/2026-06-07');
      expect(instructions).toContain('visiblePostIds: post-1, post-2');
      expect(instructions).toContain('selectedCampaignId: campaign-1');
      expect(instructions).toContain('currentPostId: post-1');
    });

    it('instructions function words the preamble as stale when leftViewAt is set (2.3)', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set(
        'ag-ui',
        JSON.stringify({
          view: 'launches',
          currentPostId: 'post-1',
          leftViewAt: '2026-07-05T00:00:00.000Z',
        })
      );

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(instructions).toContain('The user most recently viewed (may be stale');
      expect(instructions).not.toContain('The user is currently viewing:');
      expect(instructions).toContain('currentPostId: post-1');
    });

    it('instructions function unwraps the real @ag-ui/mastra readables envelope', async () => {
      // `@ag-ui/mastra` sets `requestContext.set('ag-ui', { context: [{ description,
      // value }] })` where each readable `value` is a JSON string — NOT the bare
      // `{ view, ... }` object. Regression guard for the envelope-unwrap fix.
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('ag-ui', {
        context: [
          {
            description: 'Current UI view context for the agent',
            value: JSON.stringify({
              view: 'launches',
              calendarWeek: '2026-06-01/2026-06-07',
              currentPostId: 'post-9',
            }),
          },
        ],
      });

      const instructions = await agent.instructions({
        requestContext: mockRequestContext,
      });

      expect(instructions).toContain('The user is currently viewing:');
      expect(instructions).toContain('view: launches');
      expect(instructions).toContain('calendarWeek: 2026-06-01/2026-06-07');
      expect(instructions).toContain('currentPostId: post-9');
    });

    it('instructions function omits current view preamble when ag-ui context is absent', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});

      const agent = await service.agent();
      const mockRequestContext = new Map();

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(instructions).not.toContain('The user is currently viewing:');
      expect(instructions).not.toContain('The user most recently viewed');
    });

    it('instructions function resolves org id and prepends brand voice', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});
      vi.mocked(brandsService.getDefaultBrand).mockResolvedValue({
        id: 'brand-1',
        name: 'Acme',
        instructions: 'Be witty and concise.',
        language: 'en-US',
        platformInstructions: { x: 'Keep it under 280 characters.' },
      } as any);

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('organization', JSON.stringify({ id: 'org-123' }));

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(brandsService.getDefaultBrand).toHaveBeenCalledWith('org-123');
      expect(instructions).toContain('Brand voice:');
      expect(instructions).toContain('Be witty and concise.');
      expect(instructions).toContain('Language: en-US');
      expect(instructions).toContain('Platform instructions:');
      expect(instructions).toContain('x: Keep it under 280 characters.');
    });

    it('instructions function keeps original instructions when no brand exists', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});
      vi.mocked(brandsService.getDefaultBrand).mockResolvedValue(null);

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('organization', JSON.stringify({ id: 'org-123' }));

      const instructions = await agent.instructions({ requestContext: mockRequestContext });

      expect(instructions).not.toContain('Brand voice:');
      expect(instructions).toContain('You are an agent that helps manage and schedule social media posts for users');
    });

    it('caches brand voice per org', async () => {
      vi.spyOn(service, 'loadTools').mockResolvedValue({});
      vi.mocked(brandsService.getDefaultBrand).mockResolvedValue({
        id: 'brand-1',
        name: 'Acme',
        instructions: 'Be bold.',
      } as any);

      const agent = await service.agent();
      const mockRequestContext = new Map();
      mockRequestContext.set('organization', JSON.stringify({ id: 'org-123' }));

      await agent.instructions({ requestContext: mockRequestContext });
      await agent.instructions({ requestContext: mockRequestContext });

      expect(brandsService.getDefaultBrand).toHaveBeenCalledTimes(1);
    });

    it('builds flat agent when AGENT_SUPERVISOR_ENABLED=false', async () => {
      process.env.AGENT_SUPERVISOR_ENABLED = 'false';
      const mockTools = { integrationList: {}, schedulePostTool: {} };
      vi.spyOn(service, 'loadTools').mockResolvedValue(mockTools);

      const agent = await service.agent();

      expect(agent.tools).toBe(mockTools);
      expect(agent.agents).toBeUndefined();
      await agent.model();
      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledWith('agent', undefined);
    });

    it('builds supervisor with only integrationList/groupList as direct tools by default', async () => {
      process.env.AGENT_SUPERVISOR_ENABLED = 'true';
      // pickTools now THROWS on an unresolved name, and the real specialist builders
      // run here — so the map must contain every specialist tool name, not just three.
      const allNames = [
        ...SUPERVISOR_TOOL_NAMES,
        ...CONTENT_TOOL_NAMES,
        ...MEDIA_TOOL_NAMES,
        ...ANALYTICS_TOOL_NAMES,
        ...OPS_TOOL_NAMES,
      ];
      const mockTools = Object.fromEntries(
        allNames.map((n) => [n, { id: n }])
      ) as Record<string, any>;
      vi.spyOn(service, 'loadTools').mockResolvedValue(mockTools);

      const agent = await service.agent();

      expect(agent.tools).toEqual({
        integrationList: { id: 'integrationList' },
        groupList: { id: 'groupList' },
      });
      expect(agent.agents).toEqual({
        content: expect.any(Object),
        media: expect.any(Object),
        analytics: expect.any(Object),
        ops: expect.any(Object),
      });
      await agent.model();
      expect(aiModelProvider.governedLanguageModel).toHaveBeenCalledWith('utility', undefined);
    });
  });

  describe('AgentState', () => {
    it('exports a zod schema with the real brand/cadence fields', () => {
      expect(AgentState).toBeDefined();
      expect(AgentState._def).toBeDefined();
      const shape = AgentState.shape || (AgentState as any)._def.shape;
      expect(shape).toBeDefined();
      expect(shape.brandVoice).toBeDefined();
      expect(shape.preferredPlatforms).toBeDefined();
      expect(shape.postingCadence).toBeDefined();
      expect(shape.tone).toBeDefined();
      expect(shape.doNotUse).toBeDefined();
      expect(shape.audienceNotes).toBeDefined();
    });
  });
});
