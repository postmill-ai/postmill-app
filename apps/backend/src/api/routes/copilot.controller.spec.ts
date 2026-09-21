import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CHECK_POLICIES_KEY } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';


const mockRuntimeCtor = vi.fn();
vi.mock('@copilotkit/runtime', () => ({
  CopilotRuntime: class {
    constructor(opts: any) {
      mockRuntimeCtor(opts);
      Object.assign(this, opts);
    }
  },
  copilotRuntimeNodeHttpEndpoint: vi.fn().mockReturnValue(vi.fn()),
  copilotRuntimeNestEndpoint: vi.fn().mockReturnValue(vi.fn()),
}));

const mockBuiltInAgentCtor = vi.fn();
vi.mock('@copilotkit/runtime/v2', () => ({
  BuiltInAgent: class {
    constructor(opts: any) {
      mockBuiltInAgentCtor(opts);
      Object.assign(this, opts);
    }
  },
}));

const mockLanguageModel = {
  modelId: 'gpt-5.2',
  doGenerate: vi.fn().mockResolvedValue({ text: 'agent response' }),
};

const mockOpenaiAdapter = {
  identifier: 'openai',
  name: 'OpenAI',
  type: 'direct',
  credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
  capabilities: { text: true, image: true, vision: true, embeddings: true, speech: true, tools: true },
  listModels: vi.fn().mockResolvedValue([]),
  createLanguageModel: vi.fn().mockReturnValue(mockLanguageModel),
};

const mockResolveConfigForScope = vi.fn().mockResolvedValue(null);
const mockGovernedLanguageModel = vi.fn().mockResolvedValue(mockLanguageModel);

vi.mock('@postmill-ai/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    resolveConfigForScope = mockResolveConfigForScope;
    governedLanguageModel = mockGovernedLanguageModel;
    getSurfaceDefaults = vi.fn().mockReturnValue({
      textModel: 'gpt-5.2',
      imageModel: 'chatgpt-image-latest',
    });
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));

vi.mock('@postmill-ai/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {
    mastra = vi.fn().mockResolvedValue({
      getAgent: vi.fn().mockReturnValue({
        getMemory: vi.fn().mockResolvedValue({
          listThreads: vi.fn().mockResolvedValue({ threads: [] }),
          recall: vi.fn().mockResolvedValue({ messages: [] }),
          getThreadById: vi.fn().mockResolvedValue(null),
        }),
      }),
    });
  },
}));

vi.mock('@postmill-ai/nestjs-libraries/feature-flags', () => ({
  FeatureFlagsService: class {
    isDisabled = vi.fn().mockReturnValue(false);
  },
}));

vi.mock('@ag-ui/mastra', () => ({
  MastraAgent: {
    getLocalAgents: vi.fn().mockReturnValue({}),
  },
}));

vi.mock('@mastra/core/di', () => ({
  RequestContext: class {
    private data = new Map<string, string>();
    set(key: string, value: string) { this.data.set(key, value); }
    get(key: string) { return this.data.get(key); }
  },
}));

import { CopilotController } from './copilot.controller';
import {
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNestEndpoint,
} from '@copilotkit/runtime';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { FeatureFlagsService } from '@postmill-ai/nestjs-libraries/feature-flags';
import { RequestContext } from '@mastra/core/di';
import { BudgetExceeded, GuardrailViolation } from '@postmill-ai/nestjs-libraries/ai/governance/errors';

describe('CopilotController', () => {
  let controller: CopilotController;
  let mastraService: MastraService;
  let aiModelProvider: AIModelProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveConfigForScope.mockResolvedValue(null);
    mockGovernedLanguageModel.mockResolvedValue(mockLanguageModel);

    mastraService = new (MastraService as any)();
    aiModelProvider = new (AIModelProvider as any)();

    const featureFlagsService = new (FeatureFlagsService as any)();
    controller = new CopilotController(mastraService, aiModelProvider, featureFlagsService);
  });

  describe('/chat endpoint', () => {
    // §3.5 #3AM: /chat is now gated with @CheckPolicies([Create, MCP]).
    it('is gated with CheckPolicies', () => {
      const policies = Reflect.getMetadata(
        CHECK_POLICIES_KEY,
        CopilotController.prototype.chatAgent,
      );

      expect(policies).toEqual([[AuthorizationActions.Create, Sections.MCP]]);
    });

    const configured = () =>
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-chat-test' },
        providerId: 'openai',
      });
    const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() }) as any;

    // Sentry POSTMILL-APP-D: @copilotkit/runtime ≥1.69 never calls a service
    // adapter's process(); an agents-less runtime auto-builds a BuiltInAgent from
    // the adapter and throws CopilotApiDiscoveryError (unhandled) when the adapter
    // can't name its model — every LangChainAdapter provider. The route must pass
    // an explicit default agent on the org's governed model and no adapter at all.
    it('builds the runtime with a BuiltInAgent on the governed agent model and no service adapter', async () => {
      configured();
      const org = { id: 'org-chat-1' } as any;

      await controller.chatAgent({ body: {}, headers: {} } as any, mkRes(), org);

      expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-chat-1');
      expect(mockGovernedLanguageModel).toHaveBeenCalledWith('agent', 'org-chat-1');
      expect(mockBuiltInAgentCtor).toHaveBeenCalledWith({ model: mockLanguageModel });
      const runtimeOpts = mockRuntimeCtor.mock.calls[0][0];
      expect(Object.keys(runtimeOpts.agents)).toEqual(['default']);
      expect(runtimeOpts.agents.default).toMatchObject({ model: mockLanguageModel });
      const endpointOpts = (copilotRuntimeNodeHttpEndpoint as any).mock.calls[0][0];
      expect(endpointOpts).not.toHaveProperty('serviceAdapter');
      expect(endpointOpts.endpoint).toBe('/copilot/chat');
    });

    it('rejects 422 without constructing a runtime when AI is unconfigured', async () => {
      mockResolveConfigForScope.mockResolvedValue(null);

      const callsBefore = (copilotRuntimeNodeHttpEndpoint as any).mock.calls.length;
      await expect(controller.chatAgent({ body: {}, headers: {} } as any, mkRes())).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
      expect((copilotRuntimeNodeHttpEndpoint as any).mock.calls.length).toBe(callsBefore);
      expect(mockGovernedLanguageModel).not.toHaveBeenCalled();
    });

    it('maps a budget refusal from the governed model to 429', async () => {
      configured();
      mockGovernedLanguageModel.mockRejectedValue(new BudgetExceeded('Budget exceeded', 'agent', 'org-chat-1'));

      await expect(controller.chatAgent({ body: {}, headers: {} } as any, mkRes(), { id: 'org-chat-1' } as any)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
      expect(copilotRuntimeNodeHttpEndpoint).not.toHaveBeenCalled();
    });

    it('maps a guardrail violation to 422', async () => {
      configured();
      mockGovernedLanguageModel.mockRejectedValue(new GuardrailViolation('blocked', 'pii', 'block'));

      await expect(controller.chatAgent({ body: {}, headers: {} } as any, mkRes(), { id: 'org-chat-1' } as any)).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
    });

    it('answers 500 (no throw) for an unexpected provider failure', async () => {
      configured();
      mockGovernedLanguageModel.mockRejectedValue(new Error('boom'));
      const res = mkRes();

      await controller.chatAgent({ body: {}, headers: {} } as any, res, { id: 'org-chat-1' } as any);

      expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(res.json).toHaveBeenCalledWith({ error: 'AI configuration not available' });
    });
  });

  describe('/agent endpoint', () => {
    it('checks agent config for the org and mounts the Mastra agents with no service adapter', async () => {
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-agent-test' },
        providerId: 'openai',
      });
      const req = { body: { variables: { properties: { integrations: [] } } } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const org = { id: 'org-agent-1' } as any;
      const user = { id: 'user-agent-1' } as any;

      await controller.agent(req, res, org, user);

      expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-agent-1');
      // The Mastra agent owns its model; the runtime ignores a service adapter
      // once agents are given, and building one 500'd azure/bedrock/vertex.
      expect(mockGovernedLanguageModel).not.toHaveBeenCalled();
      expect(mockBuiltInAgentCtor).not.toHaveBeenCalled();
      const endpointOpts = (copilotRuntimeNestEndpoint as any).mock.calls[0][0];
      expect(endpointOpts).not.toHaveProperty('serviceAdapter');
      expect(endpointOpts.endpoint).toBe('/copilot/agent');
    });

    it('rejects 422 without constructing a runtime when AI is unconfigured', async () => {
      mockResolveConfigForScope.mockResolvedValue(null);
      const req = { body: { variables: { properties: { integrations: [] } } } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const org = { id: 'org-agent-empty' } as any;
      const user = { id: 'user-agent-empty' } as any;

      const callsBefore = (copilotRuntimeNestEndpoint as any).mock.calls.length;
      await expect(controller.agent(req, res, org, user)).rejects.toMatchObject({
        status: HttpStatus.UNPROCESSABLE_ENTITY,
      });
      expect((copilotRuntimeNestEndpoint as any).mock.calls.length).toBe(callsBefore);
    });

    it('sets organization and user in the Mastra requestContext', async () => {
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-agent-test' },
        providerId: 'openai',
      });
      const req = { body: { variables: { properties: { integrations: [] } } } } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const org = { id: 'org-agent-ctx' } as any;
      const user = { id: 'user-agent-ctx' } as any;
      const setSpy = vi.spyOn(RequestContext.prototype, 'set');

      await controller.agent(req, res, org, user);

      const orgCall = setSpy.mock.calls.find((c) => c[0] === 'organization');
      const userCall = setSpy.mock.calls.find((c) => c[0] === 'user');
      expect(orgCall?.[1]).toBe(JSON.stringify(org));
      expect(userCall?.[1]).toBe(JSON.stringify({ id: user.id }));
      setSpy.mockRestore();
    });

    it('sets only identity/access context — never integrations/media/ag-ui from the request body', async () => {
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-agent-test' },
        providerId: 'openai',
      });
      const media = [{ id: 'file-1', path: 'https://example.com/img.png' }];
      // Both the GraphQL-era `variables.properties` and the single-route
      // `forwardedProps` legs are ignored: `ag-ui` is owned by @ag-ui/mastra,
      // and integrations/media were read by no tool.
      const agUiContext = { view: 'launches', currentPostId: 'post-1' };
      const req = {
        body: {
          variables: { properties: { integrations: ['int-1'], media, agUiContext } },
          forwardedProps: { integrations: ['int-1'], media },
        },
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const org = { id: 'org-agent-ctx2' } as any;
      const user = { id: 'user-agent-ctx2' } as any;
      const setSpy = vi.spyOn(RequestContext.prototype, 'set');

      await controller.agent(req, res, org, user);

      const keys = setSpy.mock.calls.map((c) => c[0]).sort();
      expect(keys).toEqual(['access', 'organization', 'ui', 'user']);
      setSpy.mockRestore();
    });
  });

  describe('/:thread/list endpoint', () => {
    const getMemory = async () => {
      const mastra = await (mastraService as any).mastra();
      return mastra.getAgent('postmill').getMemory();
    };
    const org = { id: 'org-1' } as any;

    it('404s when the thread is unknown to the org (never fakes an empty history)', async () => {
      const memory = await getMemory();
      memory.getThreadById.mockResolvedValue(null);

      await expect(
        controller.getMessagesList(org, 'thread-x'),
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
      expect(memory.recall).not.toHaveBeenCalled();
    });

    it('returns recalled messages for a thread the org owns', async () => {
      const memory = await getMemory();
      memory.getThreadById.mockResolvedValue({ id: 'thread-x' });
      memory.recall.mockResolvedValue({ messages: [{ id: 'm1' }] });

      const result = await controller.getMessagesList(org, 'thread-x');

      expect(memory.getThreadById).toHaveBeenCalledWith({
        threadId: 'thread-x',
        resourceId: 'org-1',
      });
      expect(result).toEqual({ messages: [{ id: 'm1' }] });
    });

    it('surfaces a recall failure as a 500 instead of swallowing it into []', async () => {
      const memory = await getMemory();
      memory.getThreadById.mockResolvedValue({ id: 'thread-x' });
      memory.recall.mockRejectedValue(new Error('storage down'));

      await expect(
        controller.getMessagesList(org, 'thread-x'),
      ).rejects.toMatchObject({
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      });
    });
  });

  describe('_reflectCredentialedCors', () => {
    const ORIGIN = 'https://app.example.com';

    it('rewrites a wildcard ACAO to the request origin (via setHeader) and asserts credentials', () => {
      const setHeader = vi.fn();
      const res = { setHeader, writeHead: vi.fn() } as any;
      const req = { headers: { origin: ORIGIN } } as any;

      (controller as any)._reflectCredentialedCors(req, res);
      res.setHeader('Access-Control-Allow-Origin', '*');

      expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin', ORIGIN);
      expect(setHeader).toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('passes non-wildcard headers through setHeader untouched (no credentials header)', () => {
      const setHeader = vi.fn();
      const res = { setHeader, writeHead: vi.fn() } as any;
      const req = { headers: { origin: ORIGIN } } as any;

      (controller as any)._reflectCredentialedCors(req, res);
      res.setHeader('Content-Type', 'text/plain');

      expect(setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(setHeader).not.toHaveBeenCalledWith('Access-Control-Allow-Credentials', 'true');
    });

    it('rewrites a wildcard ACAO in a writeHead headers object and adds credentials', () => {
      const writeHead = vi.fn();
      const res = { setHeader: vi.fn(), writeHead } as any;
      const req = { headers: { origin: ORIGIN } } as any;

      (controller as any)._reflectCredentialedCors(req, res);
      res.writeHead(200, { 'access-control-allow-origin': '*', 'content-type': 'text/plain' });

      const [status, headers] = writeHead.mock.calls.at(-1)!;
      expect(status).toBe(200);
      expect(headers['access-control-allow-origin']).toBe(ORIGIN);
      expect(headers['Access-Control-Allow-Credentials']).toBe('true');
      expect(headers['content-type']).toBe('text/plain');
    });

    it('does nothing when the request has no Origin header', () => {
      const setHeader = vi.fn();
      const writeHead = vi.fn();
      const res = { setHeader, writeHead } as any;
      const req = { headers: {} } as any;

      (controller as any)._reflectCredentialedCors(req, res);

      // No wrapping installed — the originals are left in place.
      expect(res.setHeader).toBe(setHeader);
      expect(res.writeHead).toBe(writeHead);
    });
  });
});
