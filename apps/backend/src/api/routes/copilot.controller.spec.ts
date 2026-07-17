import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const OLD_ENV = { ...process.env };

const mockOpenAIAdapterInstance = { mock: 'OpenAIAdapter', process: vi.fn().mockResolvedValue({ threadId: 't1' }) };
const mockAnthropicAdapterInstance = { mock: 'AnthropicAdapter', process: vi.fn().mockResolvedValue({ threadId: 't1' }) };
const mockGoogleAdapterInstance = { mock: 'GoogleGenerativeAIAdapter', process: vi.fn().mockResolvedValue({ threadId: 't1' }) };
const mockGroqAdapterInstance = { mock: 'GroqAdapter', process: vi.fn().mockResolvedValue({ threadId: 't1' }) };
const mockLangChainAdapterInstance = { mock: 'LangChainAdapter', process: vi.fn().mockResolvedValue({ threadId: 't1' }) };
const mockEmptyAdapterInstance = { mock: 'EmptyAdapter' };
vi.mock('@copilotkit/runtime', () => ({
  AnthropicAdapter: class {
    constructor(opts: any) {
      Object.assign(this, opts);
      return mockAnthropicAdapterInstance;
    }
  },
  CopilotRuntime: class {},
  EmptyAdapter: class {
    constructor() {
      return mockEmptyAdapterInstance;
    }
  },
  GoogleGenerativeAIAdapter: class {
    constructor(opts: any) {
      Object.assign(this, opts);
      return mockGoogleAdapterInstance;
    }
  },
  GroqAdapter: class {
    constructor(opts: any) {
      Object.assign(this, opts);
      return mockGroqAdapterInstance;
    }
  },
  LangChainAdapter: class {
    constructor(opts: any) {
      Object.assign(this, opts);
      return mockLangChainAdapterInstance;
    }
  },
  OpenAIAdapter: class {
    constructor(opts: any) {
      Object.assign(this, opts);
      return mockOpenAIAdapterInstance;
    }
  },
  copilotRuntimeNodeHttpEndpoint: vi.fn().mockReturnValue(vi.fn()),
  copilotRuntimeNestEndpoint: vi.fn().mockReturnValue(vi.fn()),
  copilotRuntimeNextJSAppRouterEndpoint: vi.fn().mockReturnValue({
    handleRequest: vi.fn(),
  }),
}));

const mockOpenAIClass = vi.fn();
vi.mock('openai', () => ({
  default: class {
    constructor(opts: any) {
      mockOpenAIClass(opts);
    }
  },
}));

const mockAnthropicClass = vi.fn();
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    constructor(opts: any) {
      mockAnthropicClass(opts);
    }
  },
}));

const mockGroqClass = vi.fn();
vi.mock('groq-sdk', () => ({
  Groq: class {
    constructor(opts: any) {
      mockGroqClass(opts);
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

const mockAnthropicAdapter = {
  identifier: 'anthropic',
  name: 'Anthropic',
  type: 'direct',
  credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
  capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  listModels: vi.fn().mockResolvedValue([]),
  createLanguageModel: vi.fn().mockReturnValue({ modelId: 'claude-sonnet', doGenerate: vi.fn() }),
};

const mockGatewayAdapter = {
  identifier: 'gateway',
  name: 'API Gateway',
  type: 'hub',
  credentialFields: [{ key: 'baseURL', label: 'Base URL', type: 'string', required: true }],
  capabilities: { text: true, image: false, vision: false, embeddings: false, speech: false, tools: true },
  listModels: vi.fn().mockResolvedValue([]),
  createLanguageModel: vi.fn().mockReturnValue({}),
};

const mockResolveConfigForScope = vi.fn().mockResolvedValue(null);

vi.mock('@gitroom/nestjs-libraries/ai/ai-model.provider', () => ({
  AIModelProvider: class {
    resolveConfigForScope = mockResolveConfigForScope;
    getSurfaceDefaults = vi.fn().mockReturnValue({
      textModel: 'gpt-5.2',
      imageModel: 'chatgpt-image-latest',
    });
  },
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));

vi.mock('@gitroom/nestjs-libraries/chat/mastra.service', () => ({
  MastraService: class {
    mastra = vi.fn().mockResolvedValue({
      getAgent: vi.fn().mockReturnValue({
        getMemory: vi.fn().mockResolvedValue({
          listThreads: vi.fn().mockResolvedValue({ threads: [] }),
          recall: vi.fn().mockResolvedValue({ messages: [] }),
        }),
      }),
    });
  },
}));

const mockCheckInput = vi.fn().mockResolvedValue('guarded input');
vi.mock('@gitroom/nestjs-libraries/ai/governance/guardrail.service', () => ({
  GuardrailService: class {
    checkInput = mockCheckInput;
  },
}));

const mockStartSpan = vi.fn().mockImplementation(async (_name, fn) => fn({ setAttribute: vi.fn() }));
vi.mock('@gitroom/nestjs-libraries/ai/governance/telemetry.service', () => ({
  TelemetryService: class {
    startSpan = mockStartSpan;
  },
}));

vi.mock('@gitroom/nestjs-libraries/feature-flags', () => ({
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
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';
import { FeatureFlagsService } from '@gitroom/nestjs-libraries/feature-flags';
import { RequestContext } from '@mastra/core/di';

function expectWrappedAdapter(result: any, rawInstance: any) {
  expect(result).not.toBe(rawInstance);
  expect(typeof result.process).toBe('function');
}

describe('CopilotController', () => {
  let controller: CopilotController;
  let mastraService: MastraService;
  let aiModelProvider: AIModelProvider;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = '';
    vi.clearAllMocks();
    mockOpenAIClass.mockClear();
    mockAnthropicClass.mockClear();
    mockGroqClass.mockClear();
    mockCheckInput.mockClear();
    mockStartSpan.mockClear();
    mockResolveConfigForScope.mockResolvedValue(null);

    mastraService = new (MastraService as any)();
    aiModelProvider = new (AIModelProvider as any)();

    const guardrailService = new (GuardrailService as any)();
    const telemetryService = new (TelemetryService as any)();
    const featureFlagsService = new (FeatureFlagsService as any)();
    controller = new CopilotController(
      mastraService,
      aiModelProvider,
      guardrailService,
      telemetryService,
      featureFlagsService,
    );
  });

  describe('_buildServiceAdapter', () => {
    describe('no admin config', () => {
      it('creates OpenAIAdapter with resolved credentials via resolveConfigForScope', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-resolved-key' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter(undefined);

        expect(mockOpenAIClass).toHaveBeenCalledWith({ apiKey: 'sk-resolved-key' });
        expectWrappedAdapter(result, mockOpenAIAdapterInstance);
        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', undefined);
      });

      it('throws 422 "AI is not configured" when resolveConfigForScope returns null', async () => {
        mockResolveConfigForScope.mockResolvedValue(null);

        await expect((controller as any)._buildServiceAdapter(undefined)).rejects.toThrow(
          expect.objectContaining({
            message: 'AI is not configured for this organization. Go to Settings → AI to configure a provider.',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          }),
        );
      });
    });

    describe('admin config present with OpenAI provider', () => {
      it('creates OpenAIAdapter with resolved credentials from facade', async () => {
        process.env.OPENAI_API_KEY = 'sk-should-not-be-used';
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-decrypted-key' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter('org-1');

        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-1');
        expect(mockOpenAIClass).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: 'sk-decrypted-key' }),
        );
        expectWrappedAdapter(result, mockOpenAIAdapterInstance);
      });

      it('uses scoped model from facade-resolved config', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-scoped-key' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter('org-1');

        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-1');
        expectWrappedAdapter(result, mockOpenAIAdapterInstance);
      });
    });

    describe('admin config present with native CopilotKit provider', () => {
      it('creates AnthropicAdapter for Anthropic', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockAnthropicAdapter,
          modelId: 'claude-sonnet',
          creds: { apiKey: 'sk-anthropic' },
          providerId: 'anthropic',
        });

        const result = await (controller as any)._buildServiceAdapter('org-1');

        expect(mockAnthropicClass).toHaveBeenCalledWith({ apiKey: 'sk-anthropic' });
        expectWrappedAdapter(result, mockAnthropicAdapterInstance);
      });
    });

    describe('admin config present, no OPENAI_API_KEY, provider="anthropic"', () => {
      it('does NOT short-circuit to env fallback — uses configured Anthropic credentials', async () => {
        process.env.OPENAI_API_KEY = '';
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockAnthropicAdapter,
          modelId: 'claude-sonnet',
          creds: { apiKey: 'sk-anthropic' },
          providerId: 'anthropic',
        });

        const result = await (controller as any)._buildServiceAdapter('org-1');

        expectWrappedAdapter(result, mockAnthropicAdapterInstance);
      });
    });

    describe('admin config with gateway adapter', () => {
      it('treats gateway as OpenAI-compatible (has baseURL field)', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockGatewayAdapter,
          modelId: 'gpt-4.1',
          creds: { apiKey: 'sk-gw-key', baseURL: 'https://my-gateway.example.com/v1' },
          providerId: 'gateway',
        });

        const result = await (controller as any)._buildServiceAdapter('org-1');

        expect(mockOpenAIClass).toHaveBeenCalledWith(
          expect.objectContaining({
            apiKey: 'sk-gw-key',
            baseURL: 'https://my-gateway.example.com/v1',
          }),
        );
        expectWrappedAdapter(result, mockOpenAIAdapterInstance);
      });

      it('does not borrow OPENAI_API_KEY when active admin credentials are missing', async () => {
        process.env.OPENAI_API_KEY = 'sk-env-key';
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockGatewayAdapter,
          modelId: 'gpt-4.1',
          creds: { baseURL: 'https://my-gateway.example.com/v1' },
          providerId: 'gateway',
        });

        await expect((controller as any)._buildServiceAdapter('org-1')).rejects.toThrow(
          expect.objectContaining({
            message: 'AI provider credentials not configured',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          }),
        );
        expect(mockOpenAIClass).not.toHaveBeenCalled();
      });
    });

    describe('resolveConfigForScope returns null (facade could not resolve)', () => {
      it('throws 422 when no config resolved (no env fallback)', async () => {
        mockResolveConfigForScope.mockResolvedValue(null);

        await expect((controller as any)._buildServiceAdapter('org-1')).rejects.toThrow(
          expect.objectContaining({
            message: 'AI is not configured for this organization. Go to Settings → AI to configure a provider.',
            status: HttpStatus.UNPROCESSABLE_ENTITY,
          }),
        );
      });
    });

    describe('per-org BYOK overrides', () => {
      it('uses credentials from per-org BYOK resolved by the facade', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-byok-org-key' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter('org-byok');

        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-byok');
        expect(mockOpenAIClass).toHaveBeenCalledWith(
          expect.objectContaining({ apiKey: 'sk-byok-org-key' }),
        );
        expectWrappedAdapter(result, mockOpenAIAdapterInstance);
      });
    });

    describe('orgId threading', () => {
      it('passes orgId to resolveConfigForScope', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-org-test' },
          providerId: 'openai',
        });

        await (controller as any)._buildServiceAdapter('org-42');

        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-42');
      });

      it('passes undefined orgId when not provided', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-no-org' },
          providerId: 'openai',
        });

        await (controller as any)._buildServiceAdapter(undefined);

        expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', undefined);
      });

      it('wraps the adapter so process() runs input guardrails and telemetry', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-guard-test' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter('org-guard');
        const textMessage = {
          type: 'TextMessage',
          isTextMessage: () => true,
          content: 'Hello agent',
        };
        await result.process({ messages: [textMessage] });

        expect(mockCheckInput).toHaveBeenCalledWith('Hello agent', { orgId: 'org-guard' });
        expect(mockStartSpan).toHaveBeenCalledWith(
          'copilot.generate',
          expect.any(Function),
          { 'ai.scope': 'agent' },
        );
      });

      it('does not run guardrails when there are no text messages', async () => {
        mockResolveConfigForScope.mockResolvedValue({
          adapter: mockOpenaiAdapter,
          modelId: 'gpt-5.2',
          creds: { apiKey: 'sk-no-text' },
          providerId: 'openai',
        });

        const result = await (controller as any)._buildServiceAdapter('org-notext');
        await result.process({ messages: [] });

        expect(mockCheckInput).not.toHaveBeenCalled();
        expect(mockStartSpan).toHaveBeenCalledWith(
          'copilot.generate',
          expect.any(Function),
          { 'ai.scope': 'agent' },
        );
      });
    });
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

    it('calls service adapter builder with organization.id', async () => {
      process.env.OPENAI_API_KEY = 'sk-chat-test';
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-chat-test' },
        providerId: 'openai',
      });
      const req = { body: {} } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const org = { id: 'org-chat-1' } as any;

      await controller.chatAgent(req, res, org);

      expect(mockResolveConfigForScope).toHaveBeenCalledWith('agent', 'org-chat-1');
    });

    it('serves EmptyAdapter (no throw) when AI is unconfigured, so the runtime-info handshake succeeds', async () => {
      process.env.OPENAI_API_KEY = '';
      mockResolveConfigForScope.mockResolvedValue(null);
      const req = { body: {} } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;

      await controller.chatAgent(req, res);

      const lastCall = (copilotRuntimeNodeHttpEndpoint as any).mock.calls.at(-1)[0];
      expect(lastCall.serviceAdapter).toBe(mockEmptyAdapterInstance);
    });
  });

  describe('/agent endpoint', () => {
    it('calls service adapter builder with organization.id', async () => {
      process.env.OPENAI_API_KEY = 'sk-agent-test';
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
    });

    it('serves EmptyAdapter (no throw) when AI is unconfigured, so the runtime-info handshake succeeds', async () => {
      process.env.OPENAI_API_KEY = '';
      mockResolveConfigForScope.mockResolvedValue(null);
      const req = { body: { variables: { properties: { integrations: [] } } } } as any;
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      } as any;
      const org = { id: 'org-agent-empty' } as any;
      const user = { id: 'user-agent-empty' } as any;

      await controller.agent(req, res, org, user);

      const lastCall = (copilotRuntimeNestEndpoint as any).mock.calls.at(-1)[0];
      expect(lastCall.serviceAdapter).toBe(mockEmptyAdapterInstance);
    });

    it('sets organization and user in the Mastra requestContext', async () => {
      process.env.OPENAI_API_KEY = 'sk-agent-test';
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

    it('sets media context from CopilotKit properties and does NOT set ag-ui from properties', async () => {
      process.env.OPENAI_API_KEY = 'sk-agent-test';
      mockResolveConfigForScope.mockResolvedValue({
        adapter: mockOpenaiAdapter,
        modelId: 'gpt-5.2',
        creds: { apiKey: 'sk-agent-test' },
        providerId: 'openai',
      });
      const media = [{ id: 'file-1', path: 'https://example.com/img.png' }];
      // agUiContext in properties is a DEAD leg: `@ag-ui/mastra` overwrites the
      // `ag-ui` request-context key from the CopilotKit readable unconditionally,
      // so the controller no longer reads or sets it (see the controller's note).
      const agUiContext = { view: 'launches', currentPostId: 'post-1' };
      const req = {
        body: {
          variables: {
            properties: { integrations: [], media, agUiContext },
          },
        },
      } as any;
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
      const org = { id: 'org-agent-ctx2' } as any;
      const user = { id: 'user-agent-ctx2' } as any;
      const setSpy = vi.spyOn(RequestContext.prototype, 'set');

      await controller.agent(req, res, org, user);

      const mediaCall = setSpy.mock.calls.find((c) => c[0] === 'media');
      const agUiCall = setSpy.mock.calls.find((c) => c[0] === 'ag-ui');
      expect(mediaCall?.[1]).toEqual(media);
      // The controller must not set ag-ui from properties.agUiContext anymore.
      expect(agUiCall).toBeUndefined();
      setSpy.mockRestore();
    });
  });

  describe('_serviceAdapterOrEmpty', () => {
    it('returns an EmptyAdapter when adapter build fails with 422 (AI unconfigured)', async () => {
      const spy = vi
        .spyOn(controller as any, '_buildServiceAdapter')
        .mockRejectedValue(
          new HttpException('AI not configured', HttpStatus.UNPROCESSABLE_ENTITY),
        );

      const result = await (controller as any)._serviceAdapterOrEmpty('org-x');

      expect(result).toBe(mockEmptyAdapterInstance);
      spy.mockRestore();
    });

    it('re-throws non-422 HttpExceptions (never masks a real adapter error)', async () => {
      const spy = vi
        .spyOn(controller as any, '_buildServiceAdapter')
        .mockRejectedValue(new HttpException('bad', HttpStatus.BAD_REQUEST));

      await expect(
        (controller as any)._serviceAdapterOrEmpty('org-x'),
      ).rejects.toThrow(HttpException);
      spy.mockRestore();
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
