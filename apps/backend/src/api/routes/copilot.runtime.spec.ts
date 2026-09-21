import { describe, it, expect } from 'vitest';
// Deliberately NOT mocked: this pins the behaviour of the installed
// @copilotkit/runtime against the way copilot.controller.ts constructs it.
import { CopilotRuntime, LangChainAdapter, copilotRuntimeNodeHttpEndpoint } from '@copilotkit/runtime';
import { BuiltInAgent } from '@copilotkit/runtime/v2';

// The shape AIModelProvider.governedLanguageModel returns: a Vercel AI SDK
// LanguageModelV2. `ai@6` (copilotkit's streamText) accepts v2 via a compat proxy.
const stubModel = {
  specificationVersion: 'v2',
  provider: 'stub',
  modelId: 'stub-model',
  supportedUrls: {},
  doGenerate: async () => ({ content: [] as unknown[], finishReason: 'stop', usage: {}, warnings: [] as unknown[] }),
  doStream: async () => ({ stream: new ReadableStream() }),
} as any;

async function resolvedAgents(runtime: CopilotRuntime) {
  // `handleServiceAdapter` stores a promise on runtimeArgs.agents; the instance
  // getter is what the HTTP handler reads. Await both so a rejection surfaces
  // here instead of as an unhandled rejection (the production symptom).
  const instance: any = (runtime as any).instance;
  return await instance.agents;
}

describe('@copilotkit/runtime construction contract (Sentry POSTMILL-APP-D)', () => {
  it('an explicit BuiltInAgent on a v2 LanguageModel resolves a default agent with no service adapter', async () => {
    const runtime = new CopilotRuntime({
      agents: { default: new BuiltInAgent({ model: stubModel }) } as any,
    });
    copilotRuntimeNodeHttpEndpoint({ endpoint: '/copilot/chat', runtime });

    const agents = await resolvedAgents(runtime);
    expect(Object.keys(agents)).toEqual(['default']);
  });

  it('documents the crash: an agents-less runtime fed a LangChainAdapter rejects with CopilotApiDiscoveryError', async () => {
    const runtime = new CopilotRuntime();
    const serviceAdapter = new LangChainAdapter({ chainFn: async () => 'never' as any });
    copilotRuntimeNodeHttpEndpoint({ endpoint: '/copilot/chat', runtime, serviceAdapter });

    // handleServiceAdapter parks a rejecting promise on runtimeArgs.agents with
    // no handler attached — exactly why prod saw it as an unhandled rejection.
    // Grab it synchronously so this test observes it instead of the process.
    const agentsPromise: Promise<unknown> = (runtime as any).runtimeArgs.agents;
    agentsPromise.catch(() => undefined);

    await expect(agentsPromise).rejects.toMatchObject({
      name: 'CopilotApiDiscoveryError',
      message: expect.stringContaining('does not provide model information'),
    });
  });
});
