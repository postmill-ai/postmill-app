import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentResponse } from '@reaatech/agent-mesh';

vi.mock('@reaatech/agent-mesh', () => ({}));
vi.mock('@reaatech/agent-mesh-router', () => ({
  dispatchToAgent: vi.fn(),
  registerInProcessAgent: vi.fn(),
}));

import { dispatchToAgent } from '@reaatech/agent-mesh-router';
import { ContentPipelineConductorService } from './content-pipeline-conductor.service';
import { CONTENT_PIPELINE_AGENT_IDS } from './pipeline-registry.data';

const IDS = CONTENT_PIPELINE_AGENT_IDS;

describe('ContentPipelineConductorService', () => {
  let budgetService: { checkBudget: ReturnType<typeof vi.fn> };
  let integrationManager: { getSocialIntegrationUnchecked: ReturnType<typeof vi.fn> };
  let conductor: ContentPipelineConductorService;

  beforeEach(() => {
    vi.clearAllMocks();
    budgetService = {
      checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
    };
    integrationManager = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue({
        maxLength: () => 280,
      }),
    };
    conductor = new ContentPipelineConductorService(
      budgetService as any,
      integrationManager as any
    );
  });

  function makeDispatchStub(
    scenarios: Record<
      string,
      AgentResponse | ((agentId: string, rawInput: string) => AgentResponse)
    >
  ) {
    (dispatchToAgent as ReturnType<typeof vi.fn>).mockImplementation(
      (agent: { agent_id?: string }, ctx: { rawInput: string }) => {
        const agentId = agent?.agent_id ?? 'unknown';
        const candidate = scenarios[agentId];
        const response =
          typeof candidate === 'function'
            ? (candidate as (agentId: string, rawInput: string) => AgentResponse)(
                agentId,
                ctx.rawInput
              )
            : candidate;
        return Promise.resolve(response ?? { content: '{}', workflow_complete: false });
      }
    );
  }

  it('runs strategist → copywriter → brand-critic → finalizer when critic passes', async () => {
    makeDispatchStub({
      [IDS.strategist]: {
        content: JSON.stringify({
          platforms: ['x', 'linkedin'],
          angles: ['Launch angle'],
          hooks: ['Big news'],
          structure: 'Hook → body → CTA',
        }),
        workflow_complete: false,
      },
      [IDS.copywriter]: {
        content: JSON.stringify({
          perPlatform: {
            x: 'Big news — we launched!',
            linkedin: 'We are thrilled to announce our launch.',
          },
        }),
        workflow_complete: false,
      },
      [IDS.brandCritic]: {
        content: JSON.stringify({ pass: true, fixes: [] }),
        workflow_complete: false,
      },
      [IDS.finalizer]: {
        content: JSON.stringify({
          content: ['Big news — we launched!', 'We are thrilled to announce our launch.'],
          perPlatform: {
            x: 'Big news — we launched!',
            linkedin: 'We are thrilled to announce our launch.',
          },
        }),
        workflow_complete: true,
      },
    });

    const result = await conductor.generate('org-1', 'user-1', {
      brief: 'Launch announcement',
      platforms: ['x', 'linkedin'],
      tone: 'excited',
    });

    const calls = (dispatchToAgent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([agent]: any[]) => agent?.agent_id
    );
    expect(calls).toEqual([
      IDS.strategist,
      IDS.copywriter,
      IDS.brandCritic,
      IDS.finalizer,
    ]);
    expect(result.content).toHaveLength(2);
    expect(result.perPlatform.x).toBe('Big news — we launched!');
    expect(result.critique?.pass).toBe(true);
  });

  it('revises once when the brand critic fails and then stops', async () => {
    const copywriterCalls: string[] = [];

    makeDispatchStub({
      [IDS.strategist]: {
        content: JSON.stringify({
          platforms: ['x'],
          angles: ['Launch'],
          hooks: ['Big news'],
          structure: 'Hook → CTA',
        }),
        workflow_complete: false,
      },
      [IDS.copywriter]: (agentId, rawInput) => {
        copywriterCalls.push(rawInput);
        const hasFixes = rawInput.includes('make it punchier');
        return {
          content: JSON.stringify({
            perPlatform: {
              x: hasFixes ? 'Punchy launch tweet!' : 'Launch tweet.',
            },
          }),
          workflow_complete: false,
        };
      },
      [IDS.brandCritic]: {
        content: JSON.stringify({ pass: false, fixes: ['make it punchier'] }),
        workflow_complete: false,
      },
      [IDS.finalizer]: {
        content: JSON.stringify({
          content: ['Punchy launch tweet!'],
          perPlatform: { x: 'Punchy launch tweet!' },
        }),
        workflow_complete: true,
      },
    });

    const result = await conductor.generate('org-1', 'user-1', {
      brief: 'Launch',
      platforms: ['x'],
    });

    expect(copywriterCalls).toHaveLength(2);
    expect(copywriterCalls[1]).toContain('make it punchier');
    const calls = (dispatchToAgent as ReturnType<typeof vi.fn>).mock.calls.map(
      ([agent]: any[]) => agent?.agent_id
    );
    expect(calls).toEqual([
      IDS.strategist,
      IDS.copywriter,
      IDS.brandCritic,
      IDS.copywriter,
      IDS.finalizer,
    ]);
    expect(result.perPlatform.x).toBe('Punchy launch tweet!');
  });

  it('calls budget check per dispatch and opens the circuit breaker after 5 failures', async () => {
    (dispatchToAgent as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('provider down')
    );

    for (let i = 0; i < 5; i++) {
      await expect(
        conductor.generate('org-1', 'user-1', { brief: 'test' })
      ).rejects.toThrow('provider down');
    }

    expect(budgetService.checkBudget).toHaveBeenCalledTimes(5);
    expect(budgetService.checkBudget).toHaveBeenCalledWith('agent', 'org-1');

    // The sixth call should short-circuit before spending budget again.
    await expect(
      conductor.generate('org-1', 'user-1', { brief: 'test' })
    ).rejects.toThrow(new RegExp(`Circuit open for agent ${IDS.strategist}`));

    expect(budgetService.checkBudget).toHaveBeenCalledTimes(5);
  });

  it('spends under utility scope for the critic and skips budget for the finalizer', async () => {
    makeDispatchStub({
      [IDS.strategist]: {
        content: JSON.stringify({ platforms: ['x'], angles: [], hooks: [], structure: 's' }),
        workflow_complete: false,
      },
      [IDS.copywriter]: {
        content: JSON.stringify({ perPlatform: { x: 'copy' } }),
        workflow_complete: false,
      },
      [IDS.brandCritic]: {
        content: JSON.stringify({ pass: true, fixes: [] }),
        workflow_complete: false,
      },
      [IDS.finalizer]: {
        content: JSON.stringify({ content: ['copy'], perPlatform: { x: 'copy' } }),
        workflow_complete: true,
      },
    });

    await conductor.generate('org-1', 'user-1', { brief: 'b', platforms: ['x'] });

    const scopes = budgetService.checkBudget.mock.calls.map(([scope]) => scope);
    // strategist + copywriter → 'agent', brand-critic → 'utility', finalizer → none.
    expect(scopes).toEqual(['agent', 'agent', 'utility']);
  });

  it('throws when the finalized output is empty instead of returning a hollow success', async () => {
    makeDispatchStub({
      [IDS.strategist]: {
        content: JSON.stringify({ platforms: ['x'], angles: [], hooks: [], structure: 's' }),
        workflow_complete: false,
      },
      [IDS.copywriter]: {
        content: JSON.stringify({ perPlatform: { x: 'copy' } }),
        workflow_complete: false,
      },
      [IDS.brandCritic]: {
        content: JSON.stringify({ pass: true, fixes: [] }),
        workflow_complete: false,
      },
      [IDS.finalizer]: {
        content: JSON.stringify({ content: [], perPlatform: {} }),
        workflow_complete: true,
      },
    });

    await expect(
      conductor.generate('org-1', 'user-1', { brief: 'b', platforms: ['x'] })
    ).rejects.toThrow('Content pipeline produced no output');
  });

  it('coerces a wrong-typed strategist plan to defaults without throwing or tripping the breaker', async () => {
    let copywriterPlan: unknown;
    makeDispatchStub({
      // LLM returned strings where arrays are expected.
      [IDS.strategist]: {
        content: JSON.stringify({ angles: 'keep it fun', platforms: 'x' }),
        workflow_complete: false,
      },
      [IDS.copywriter]: (_agentId, rawInput) => {
        copywriterPlan = JSON.parse(rawInput).plan;
        return {
          content: JSON.stringify({ perPlatform: { x: 'copy' } }),
          workflow_complete: false,
        };
      },
      [IDS.brandCritic]: {
        content: JSON.stringify({ pass: true, fixes: [] }),
        workflow_complete: false,
      },
      [IDS.finalizer]: {
        content: JSON.stringify({ content: ['copy'], perPlatform: { x: 'copy' } }),
        workflow_complete: true,
      },
    });

    const result = await conductor.generate('org-1', 'user-1', {
      brief: 'b',
      platforms: ['x'],
    });

    // Defaults applied: platforms fall back to the requested list, angles to [].
    expect((copywriterPlan as any).platforms).toEqual(['x']);
    expect((copywriterPlan as any).angles).toEqual([]);
    expect(result.perPlatform.x).toBe('copy');
    // No dispatch threw, so no breaker entry was recorded.
    expect((conductor as any)._breakers.size).toBe(0);
  });

  it('rejects early once the overall deadline has passed before a later stage', async () => {
    process.env.CONTENT_PIPELINE_TOTAL_TIMEOUT_MS = '100';
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      (dispatchToAgent as ReturnType<typeof vi.fn>).mockImplementation(
        (agent: { agent_id?: string }) => {
          // Each completed stage advances the clock by 60ms; two stages exhaust
          // the 100ms budget, so the third stage is rejected before dispatch.
          now += 60;
          if (agent?.agent_id === IDS.strategist) {
            return Promise.resolve({
              content: JSON.stringify({ platforms: ['x'], angles: [], hooks: [], structure: 's' }),
              workflow_complete: false,
            });
          }
          return Promise.resolve({
            content: JSON.stringify({ perPlatform: { x: 'copy' } }),
            workflow_complete: false,
          });
        }
      );

      await expect(
        conductor.generate('org-1', 'user-1', { brief: 'b', platforms: ['x'] })
      ).rejects.toThrow(/deadline exceeded before agent/);

      // The strategist and copywriter dispatched; the brand critic never did.
      const dispatched = (dispatchToAgent as ReturnType<typeof vi.fn>).mock.calls.map(
        ([agent]: any[]) => agent?.agent_id
      );
      expect(dispatched).toEqual([IDS.strategist, IDS.copywriter]);
    } finally {
      nowSpy.mockRestore();
      delete process.env.CONTENT_PIPELINE_TOTAL_TIMEOUT_MS;
    }
  });
});
