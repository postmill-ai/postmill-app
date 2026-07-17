/**
 * Routing eval — two layers:
 *
 * 1. DETERMINISTIC (always on, hermetic, no model key): structural checks — every
 *    expected tool id exists on the flat set; each specialist owns its expected
 *    tool with a description matching the routing keywords; and the MCP/A2A tool
 *    union (supervisor ∪ specialists, built from the exported *_TOOL_NAMES) equals
 *    the full `loadTools()` inventory EXACTLY (no missing, no extra). This is the
 *    §3.3 backward-compat guard: a tool registered but unassigned, or a renamed
 *    tool name, fails here.
 *
 * 2. LIVE_EVAL=1 (opt-in, needs a real model key, kept OUT of PR CI): actually
 *    drives `postmill.generate(prompt)` per routing case and asserts the run
 *    delegated to the expected specialist (from the tool-call trace). This is the
 *    only layer that guarantees routing QUALITY (that tiering didn't regress which
 *    specialist handles a prompt). Run manually/scheduled — see the block below.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@gitroom/nestjs-libraries/chat/mastra.store', () => ({
  pStore: { _type: 'mock.mastra.store' },
}));

import { LoadToolsService, SUPERVISOR_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { pickTools } from '@gitroom/nestjs-libraries/chat/agents/specialist-tool-subset';
import { CONTENT_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/content.agent';
import { MEDIA_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/media.agent';
import { ANALYTICS_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/analytics.agent';
import { OPS_TOOL_NAMES } from '@gitroom/nestjs-libraries/chat/agents/ops.agent';
import { ToolFirewallService } from '@gitroom/nestjs-libraries/ai/governance/tool-firewall.service';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { ModuleRef } from '@nestjs/core';
import { ContentAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/content.agent';
import { MediaAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/media.agent';
import { AnalyticsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/analytics.agent';
import { OpsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/ops.agent';
import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';

const liveEval = process.env.LIVE_EVAL === '1';

const mockIntegrationManager = {
  getAllowedSocialsIntegrations: () => [
    'x',
    'linkedin',
    'facebook',
    'instagram',
    'bluesky',
    'threads',
    'tiktok',
    'youtube',
    'pinterest',
    'reddit',
    'discord',
    'telegram',
    'slack',
    'wordpress',
    'devto',
    'hashnode',
    'medium',
  ],
  getSocialIntegrationUnchecked: () => ({}),
};

const instantiateTool = (ToolClass: any): any => {
  if (ToolClass === IntegrationValidationTool) {
    return new ToolClass(mockIntegrationManager);
  }
  if (ToolClass === IntegrationTriggerTool) {
    return new ToolClass(mockIntegrationManager, {}, {});
  }
  return Reflect.construct(ToolClass, new Array(ToolClass.length).fill(undefined));
};

/**
 * Build the flat tools map without spinning up the full Nest container.
 * Tool constructors only assign services to private fields, so passing undefined
 * for every dependency is safe for the description-only deterministic checks.
 */
const buildFlatTools = async (): Promise<Record<string, any>> => {
  const firewall = new ToolFirewallService();
  const entries = await Promise.all(
    toolList.map(async (ToolClass: any) => {
      const instance = instantiateTool(ToolClass);
      const tool = await instance.run();
      return { name: instance.name as string, tool: firewall.wrap(instance.name, tool) };
    })
  );
  return entries.reduce(
    (acc, { name, tool }) => ({ ...acc, [name]: tool }),
    {} as Record<string, any>
  );
};

const buildLoadToolsService = async () => {
  const aiModelProvider = {
    languageModel: (scope: string, orgId?: string) => ({
      id: `fake-${scope}-model`,
      scope,
      orgId,
    }),
  } as any;

  const brandsService = {
    getDefaultBrand: async () => null,
  } as any;

  const moduleRef = {
    get: (type: any) => {
      if (toolList.includes(type)) {
        return instantiateTool(type);
      }
      return undefined;
    },
  } as unknown as ModuleRef;

  const toolFirewall = new ToolFirewallService();

  return new LoadToolsService(
    moduleRef,
    aiModelProvider,
    toolFirewall,
    brandsService,
    new ContentAgentBuilder(aiModelProvider),
    new MediaAgentBuilder(aiModelProvider),
    new AnalyticsAgentBuilder(aiModelProvider),
    new OpsAgentBuilder(aiModelProvider)
  );
};

type Specialist = 'supervisor' | 'content' | 'media' | 'analytics' | 'ops';

interface RoutingCase {
  prompt: string;
  expectedToolId: string;
  expectedSpecialist: Specialist;
  keywords: string[];
}

const ROUTING_CASES: RoutingCase[] = [
  // Supervisor direct tools
  {
    prompt: 'List my channels',
    expectedToolId: 'integrationList',
    expectedSpecialist: 'supervisor',
    keywords: ['integrations', 'schedule'],
  },
  {
    prompt: 'List my customer groups',
    expectedToolId: 'groupList',
    expectedSpecialist: 'supervisor',
    keywords: ['groups', 'customers'],
  },

  // Analytics
  {
    prompt: 'How are my channels doing this month?',
    expectedToolId: 'analyticsOverview',
    expectedSpecialist: 'analytics',
    keywords: ['analytics', 'overview', 'channels'],
  },
  {
    prompt: 'What are my stats for the last 30 days?',
    expectedToolId: 'analyticsOverview',
    expectedSpecialist: 'analytics',
    keywords: ['analytics', 'overview'],
  },
  {
    prompt: 'When is the best time to post on LinkedIn?',
    expectedToolId: 'bestTime',
    expectedSpecialist: 'analytics',
    keywords: ['best', 'time', 'post'],
  },
  {
    prompt: 'Give me recommendations to improve engagement',
    expectedToolId: 'recommendations',
    expectedSpecialist: 'analytics',
    keywords: ['recommendations'],
  },
  {
    prompt: 'How did my post abc-123 perform?',
    expectedToolId: 'analyticsPost',
    expectedSpecialist: 'analytics',
    keywords: ['post', 'analytics'],
  },
  {
    prompt: 'How am I doing versus @competitor?',
    expectedToolId: 'watchlist',
    expectedSpecialist: 'analytics',
    keywords: ['competitors'],
  },

  // Media
  {
    prompt: 'Generate an image of a sunset',
    expectedToolId: 'generateImageTool',
    expectedSpecialist: 'media',
    keywords: ['generate', 'image'],
  },
  {
    prompt: 'Make a video for my product launch',
    expectedToolId: 'generateVideoTool',
    expectedSpecialist: 'media',
    keywords: ['generate', 'video'],
  },
  {
    prompt: 'List my media providers',
    expectedToolId: 'listMediaProviders',
    expectedSpecialist: 'media',
    keywords: ['media', 'providers'],
  },
  {
    prompt: 'What models does Runway offer?',
    expectedToolId: 'listMediaModels',
    expectedSpecialist: 'media',
    keywords: ['media', 'models'],
  },
  {
    prompt: 'Create a video with Runway',
    expectedToolId: 'mediaStudioGenerate',
    expectedSpecialist: 'media',
    keywords: ['media', 'generate', 'provider'],
  },
  {
    prompt: 'Is my media job done?',
    expectedToolId: 'mediaJobStatus',
    expectedSpecialist: 'media',
    keywords: ['job', 'status'],
  },
  {
    prompt: 'Find my logo in the file library',
    expectedToolId: 'filesSearch',
    expectedSpecialist: 'media',
    keywords: ['files', 'search'],
  },
  {
    prompt: 'Search free stock photos of cats',
    expectedToolId: 'stockSearch',
    expectedSpecialist: 'media',
    keywords: ['stock', 'media'],
  },
  {
    prompt: 'Open this image in the Designer',
    expectedToolId: 'designerDesign',
    expectedSpecialist: 'media',
    keywords: ['designer'],
  },
  {
    prompt: 'Upload this image from a URL',
    expectedToolId: 'uploadFromUrlTool',
    expectedSpecialist: 'media',
    keywords: ['upload', 'url'],
  },

  // Content
  {
    prompt: 'Write a caption about our sale',
    expectedToolId: 'generatePostContent',
    expectedSpecialist: 'content',
    keywords: ['generate', 'post', 'content'],
  },
  {
    prompt: 'Run the generator for a thread about AI',
    expectedToolId: 'runGenerator',
    expectedSpecialist: 'content',
    keywords: ['generator', 'research'],
  },
  {
    prompt: 'Search brand memory for launch posts',
    expectedToolId: 'brandMemorySearch',
    expectedSpecialist: 'content',
    keywords: ['brand', 'memory'],
  },
  {
    prompt: 'What is my brand voice?',
    expectedToolId: 'brandProfile',
    expectedSpecialist: 'content',
    keywords: ['brand', 'profile'],
  },
  {
    prompt: 'Reindex my brand memory',
    expectedToolId: 'brandMemoryReindex',
    expectedSpecialist: 'content',
    keywords: ['brand', 'memory', 'index'],
  },
  {
    prompt: 'Search RAG for past campaigns',
    expectedToolId: 'ragSearch',
    expectedSpecialist: 'content',
    keywords: ['rag', 'search'],
  },

  // Ops
  {
    prompt: 'What settings does LinkedIn need before I schedule?',
    expectedToolId: 'integrationSchema',
    expectedSpecialist: 'ops',
    keywords: ['schema', 'integration'],
  },
  {
    prompt: 'Look up the board id for my Pinterest account',
    expectedToolId: 'triggerTool',
    expectedSpecialist: 'ops',
    keywords: ['settings'],
  },
  {
    prompt: 'Run the full content pipeline for a product launch',
    expectedToolId: 'runContentPipeline',
    expectedSpecialist: 'content',
    keywords: ['pipeline'],
  },
  {
    prompt: 'Schedule a post to LinkedIn tomorrow',
    expectedToolId: 'schedulePostTool',
    expectedSpecialist: 'ops',
    keywords: ['schedule', 'post'],
  },
  {
    prompt: 'What posts are scheduled this week?',
    expectedToolId: 'listPosts',
    expectedSpecialist: 'ops',
    keywords: ['list', 'posts'],
  },
  {
    prompt: 'Get post details for abc-123',
    expectedToolId: 'getPost',
    expectedSpecialist: 'ops',
    keywords: ['get', 'post'],
  },
  {
    prompt: 'Move my Friday post to Monday',
    expectedToolId: 'reschedulePost',
    expectedSpecialist: 'ops',
    keywords: ['reschedule', 'post'],
  },
  {
    prompt: 'Delete post group xyz',
    expectedToolId: 'deletePost',
    expectedSpecialist: 'ops',
    keywords: ['delete', 'post'],
  },
  {
    prompt: 'Approve my pending drafts',
    expectedToolId: 'approveDraft',
    expectedSpecialist: 'ops',
    keywords: ['approve', 'draft'],
  },
  {
    prompt: 'Create a campaign for Q3 launch',
    expectedToolId: 'campaignCreate',
    expectedSpecialist: 'ops',
    keywords: ['campaign', 'create'],
  },
  {
    prompt: 'Update campaign abc',
    expectedToolId: 'campaignUpdate',
    expectedSpecialist: 'ops',
    keywords: ['campaign', 'update'],
  },
  {
    prompt: 'Show campaign dashboard for abc',
    expectedToolId: 'campaignDashboard',
    expectedSpecialist: 'ops',
    keywords: ['campaign', 'dashboard'],
  },
  {
    prompt: 'Tag a post to campaign abc',
    expectedToolId: 'campaignTag',
    expectedSpecialist: 'ops',
    keywords: ['campaign', 'tag'],
  },
  {
    prompt: 'Show my comments inbox',
    expectedToolId: 'commentsInbox',
    expectedSpecialist: 'ops',
    keywords: ['comments', 'inbox'],
  },
  {
    prompt: 'Reply to comment 456',
    expectedToolId: 'commentReply',
    expectedSpecialist: 'ops',
    keywords: ['comment', 'reply'],
  },
];

const findToolById = (
  tools: Record<string, any>,
  id: string
): { key: string; tool: any } | undefined => {
  for (const [key, tool] of Object.entries(tools)) {
    if (tool?.id === id) {
      return { key, tool };
    }
  }
  return undefined;
};

const descriptionMatches = (tool: any, keywords: string[]): boolean => {
  const description = (tool?.description ?? '').toLowerCase();
  return keywords.every((kw) => description.includes(kw.toLowerCase()));
};

describe('routing eval', () => {
  const supervisorMode = process.env.AGENT_SUPERVISOR_ENABLED !== 'false';

  it('runs in supervisor mode (loud warning if the suite started flat)', () => {
    if (!supervisorMode) {
      // Don't silently reshape the whole suite to flat mode — surface it.
      console.warn(
        '[routing.eval] AGENT_SUPERVISOR_ENABLED=false at suite start — the ' +
          '"[supervisor]" routing cases are exercising FLAT mode, not delegation. ' +
          'Unset the flag for the real routing gate.'
      );
    }
    expect(typeof supervisorMode).toBe('boolean');
  });

  it('has at least 30 routing cases', () => {
    expect(ROUTING_CASES.length).toBeGreaterThanOrEqual(30);
  });

  it('builds the flat tool set for the eval harness', async () => {
    const tools = await buildFlatTools();
    expect(Object.keys(tools).length).toBeGreaterThanOrEqual(toolList.length);
  });

  it('every expected tool id is present in the flat tool set', async () => {
    const tools = await buildFlatTools();
    for (const testCase of ROUTING_CASES) {
      const found = findToolById(tools, testCase.expectedToolId);
      expect(found).toBeDefined();
    }
  });

  for (const testCase of ROUTING_CASES) {
    it(`${supervisorMode ? '[supervisor] ' : '[flat] '}${testCase.prompt} → ${testCase.expectedToolId}`, async () => {
      const service = await buildLoadToolsService();
      const postmill = await service.agent();

      let toolSource: Record<string, any>;
      if (!supervisorMode || testCase.expectedSpecialist === 'supervisor') {
        toolSource = await postmill.listTools();
      } else {
        const staticAgents = ((postmill as any).__getStaticAgents?.() ?? {}) as Record<string, any>;
        const specialist = staticAgents[testCase.expectedSpecialist];
        expect(specialist).toBeDefined();
        toolSource = await (specialist as any).listTools();
      }

      const found = findToolById(toolSource, testCase.expectedToolId);
      expect(found).toBeDefined();
      expect(descriptionMatches(found!.tool, testCase.keywords)).toBe(true);
    });
  }

  it('flat agent includes all expected tools directly on postmill', async () => {
    // Isolate the env flip so a mid-test throw can't leak flat mode into sibling
    // tests (which read AGENT_SUPERVISOR_ENABLED at their own construction time).
    vi.stubEnv('AGENT_SUPERVISOR_ENABLED', 'false');
    try {
      const service = await buildLoadToolsService();
      const postmill = await service.agent();
      const tools = await postmill.listTools();

      for (const testCase of ROUTING_CASES) {
        const found = findToolById(tools, testCase.expectedToolId);
        expect(found, `missing ${testCase.expectedToolId}`).toBeDefined();
        expect(
          descriptionMatches(found!.tool, testCase.keywords),
          `description mismatch for ${testCase.expectedToolId}`
        ).toBe(true);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // §3.3 backward-compat guard, built from in-repo sources (NOT Mastra internals):
  // the union of supervisor + specialist tool NAMES must resolve to EXACTLY the
  // full loadTools() inventory. A tool registered but unassigned (missing from
  // every *_TOOL_NAMES) fails here; a renamed tool makes pickTools throw. This is
  // what the MCP/A2A surface is now built from in start.mcp.ts.
  it('MCP tool-union parity: supervisor ∪ specialists === full inventory', async () => {
    const flat = await buildFlatTools();
    const allNames = [
      ...SUPERVISOR_TOOL_NAMES,
      ...CONTENT_TOOL_NAMES,
      ...MEDIA_TOOL_NAMES,
      ...ANALYTICS_TOOL_NAMES,
      ...OPS_TOOL_NAMES,
    ];
    // pickTools throws if any name no longer resolves (rename/removal guard).
    const union = pickTools(flat, allNames);
    const unionKeys = new Set(Object.keys(union));
    const flatKeys = new Set(Object.keys(flat));

    // No tool left unassigned, none conjured — exact set equality.
    expect([...flatKeys].filter((k) => !unionKeys.has(k))).toEqual([]);
    expect(unionKeys.size).toBe(flatKeys.size);
    expect(unionKeys.size).toBe(toolList.length);
  });

  it('supervisor owns its own working memory (specialists inherit it, per Mastra 1.41)', async () => {
    // Real @mastra/core Agent here (not mocked). Memory lives in a private field,
    // so assert via the public hasOwnMemory() — the vacuous `.memory === undefined`
    // check passed even with a memory configured. Supervisor must own memory so
    // Mastra injects its store into the memory-less specialists.
    const service = await buildLoadToolsService();
    const supervisor = await service.agent();
    expect((supervisor as any).hasOwnMemory()).toBe(true);
  });

  it('every routing-case tool id is covered by the union', async () => {
    const flat = await buildFlatTools();
    const union = pickTools(flat, [
      ...SUPERVISOR_TOOL_NAMES,
      ...CONTENT_TOOL_NAMES,
      ...MEDIA_TOOL_NAMES,
      ...ANALYTICS_TOOL_NAMES,
      ...OPS_TOOL_NAMES,
    ]);
    for (const testCase of ROUTING_CASES) {
      const found = findToolById(union, testCase.expectedToolId);
      expect(found, `union missing ${testCase.expectedToolId}`).toBeDefined();
    }
  });

  // ── LIVE_EVAL=1 (opt-in, real model key, NOT in PR CI) ──
  // The ONLY layer that tests routing QUALITY. It drives a real supervisor turn
  // per case and asserts the run delegated to the expected specialist by reading
  // the tool-call trace (supervisor delegation surfaces as an `agent-<name>` /
  // `<name>` tool call). Requires a configured model on the fake provider being
  // swapped for a real one — wire AGENT_LIVE_EVAL model creds before running:
  //   LIVE_EVAL=1 npx vitest run --root libraries/nestjs-libraries routing.eval
  if (liveEval) {
    for (const testCase of ROUTING_CASES) {
      if (testCase.expectedSpecialist === 'supervisor') continue;
      it(`[live] "${testCase.prompt}" delegates to ${testCase.expectedSpecialist}`, async () => {
        const service = await buildLoadToolsService();
        const postmill = await service.agent();
        expect(typeof (postmill as any).generate).toBe('function');

        const result: any = await (postmill as any).generate(testCase.prompt);
        // Collect every tool/agent name touched during the run.
        const steps: any[] = result?.steps ?? result?.response?.steps ?? [];
        const calledNames = new Set<string>();
        for (const step of steps) {
          for (const tc of step?.toolCalls ?? []) {
            if (tc?.toolName) calledNames.add(String(tc.toolName));
          }
        }
        const delegated =
          calledNames.has(`agent-${testCase.expectedSpecialist}`) ||
          calledNames.has(testCase.expectedSpecialist) ||
          calledNames.has(testCase.expectedToolId);
        expect(
          delegated,
          `expected delegation to ${testCase.expectedSpecialist} (or direct ${testCase.expectedToolId}); saw: ${[...calledNames].join(', ')}`
        ).toBe(true);
      });
    }
  }
});
