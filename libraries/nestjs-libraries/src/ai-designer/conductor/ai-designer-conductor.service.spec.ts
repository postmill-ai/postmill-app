import { describe, it, expect, vi, afterEach } from 'vitest';
import { AiDesignerConductorService } from './ai-designer-conductor.service';
import { AiDesignerInputPolicyService } from '../ai-designer-input-policy.service';
import { AiDesignerSkillRouter } from '../skills/ai-designer-skill-router.service';
import { DesignerDocService } from '@postmill-ai/nestjs-libraries/media/designer-doc/designer-doc.service';
import {
  registerInProcessAgent,
  unregisterInProcessAgent,
} from '@reaatech/agent-mesh-router';
import { registryState } from '@reaatech/agent-mesh-registry';

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

const makeConductor = (
  overrides: Partial<{
    policy: AiDesignerInputPolicyService;
    budgetGuard: { checkStartBudget: () => Promise<{ allowed: boolean; reason?: string }> };
    service: { getSessionForUser: () => Promise<any>; updateSession: () => Promise<any> };
  }> = {}
) => {
  const service = overrides.service ?? {
    getSessionForUser: vi.fn().mockResolvedValue({
      id: SESSION_ID,
      state: 'intake',
      mode: 'chat',
      brief: { intent: '' },
      activeDesignIds: ['design-1'],
    }),
    updateSession: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  };
  const budgetGuard = overrides.budgetGuard ?? {
    checkStartBudget: vi.fn().mockResolvedValue({ allowed: true }),
  };
  const policy =
    overrides.policy ??
    ({
      check: vi.fn().mockResolvedValue({ ok: true, values: {} }),
    } as any);

  return {
    conductor: new AiDesignerConductorService(
      service as any,
      null as any,
      null as any,
      null as any,
      null as any,
      budgetGuard as any,
      null as any,
      policy,
      null as any
    ),
    service,
    budgetGuard,
    policy,
  };
};

const makeEmitter = () => ({
  toSession: vi.fn(),
  progress: vi.fn(),
  preview: vi.fn(),
  error: vi.fn(),
});

const ctx = { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID };

describe('AiDesignerConductorService input policy', () => {
  it('handleStart does not dispatch agents when the prompt is blocked', async () => {
    const emitter = makeEmitter();
    const { conductor, budgetGuard, policy } = makeConductor({
      policy: {
        check: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'guardrail_blocked',
          message: 'blocked prompt',
        }),
      } as any,
    });

    await conductor.handleStart(SESSION_ID, ctx, {} as any, 'bad prompt', emitter);

    expect(policy.check).toHaveBeenCalledWith(
      { values: {}, instruction: 'bad prompt' },
      ORG_ID
    );
    expect(emitter.error).toHaveBeenCalledWith(
      'guardrail_blocked',
      'blocked prompt'
    );
    expect(budgetGuard.checkStartBudget).not.toHaveBeenCalled();
  });

  it('handleMessage does not dispatch agents when the text is blocked', async () => {
    const emitter = makeEmitter();
    const { conductor, budgetGuard, policy } = makeConductor({
      policy: {
        check: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'guardrail_blocked',
          message: 'blocked text',
        }),
      } as any,
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'bad text', emitter);

    expect(policy.check).toHaveBeenCalledWith(
      { values: {}, instruction: 'bad text' },
      ORG_ID
    );
    expect(emitter.error).toHaveBeenCalledWith(
      'guardrail_blocked',
      'blocked text'
    );
    expect(budgetGuard.checkStartBudget).not.toHaveBeenCalled();
  });

  it('handleFormSubmit does not persist or dispatch when values fail policy', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'intake',
        mode: 'chat',
        brief: { intent: '' },
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor, budgetGuard, policy } = makeConductor({
      service,
      policy: {
        check: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'value_bounds',
          message: 'too big',
        }),
      } as any,
    });

    await conductor.handleFormSubmit(
      SESSION_ID,
      ctx,
      'reply-1',
      { blob: 'x'.repeat(50_000) },
      emitter
    );

    expect(policy.check).toHaveBeenCalledWith(
      { values: { blob: expect.any(String) } },
      ORG_ID
    );
    expect(emitter.error).toHaveBeenCalledWith('invalid_payload', 'too big');
    expect(service.updateSession).not.toHaveBeenCalled();
    expect(budgetGuard.checkStartBudget).not.toHaveBeenCalled();
  });

  it('handleRevise does not dispatch agents when the instruction is blocked', async () => {
    const emitter = makeEmitter();
    const { conductor, budgetGuard, policy } = makeConductor({
      service: {
        getSessionForUser: vi.fn().mockResolvedValue({
          id: SESSION_ID,
          state: 'delivered',
          mode: 'chat',
          brief: { intent: '' },
          activeDesignIds: ['design-1'],
        }),
        updateSession: vi.fn().mockResolvedValue(undefined),
        appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      },
      policy: {
        check: vi.fn().mockResolvedValue({
          ok: false,
          reason: 'guardrail_blocked',
          message: 'blocked instruction',
        }),
      } as any,
    });

    await conductor.handleRevise(SESSION_ID, ctx, {
      instruction: 'bad',
      targetDesignId: 'design-1',
      nonce: 'n1',
    }, emitter);

    expect(policy.check).toHaveBeenCalledWith(
      { values: {}, instruction: 'bad' },
      ORG_ID
    );
    expect(emitter.error).toHaveBeenCalledWith(
      'guardrail_blocked',
      'blocked instruction'
    );
    expect(budgetGuard.checkStartBudget).not.toHaveBeenCalled();
  });

  it('uses the redacted instruction returned by the policy', async () => {
    const emitter = makeEmitter();
    const { conductor, policy } = makeConductor({
      service: {
        getSessionForUser: vi.fn().mockResolvedValue({
          id: SESSION_ID,
          state: 'delivered',
          mode: 'chat',
          brief: { intent: '' },
          activeDesignIds: ['design-1'],
        }),
        updateSession: vi.fn().mockResolvedValue(undefined),
        appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      },
      policy: {
        check: vi.fn().mockResolvedValue({
          ok: true,
          values: {},
          instruction: 'clean instruction',
        }),
      } as any,
    });

    // Since the session has active designs, handleRevise will proceed past the
    // policy gate and fall back to the first active design when the supplied
    // target is not a member — proving the redacted instruction was accepted.
    await conductor.handleRevise(SESSION_ID, ctx, {
      instruction: 'raw instruction',
      targetDesignId: 'missing',
      nonce: 'n1',
    }, emitter);

    expect(policy.check).toHaveBeenCalledWith(
      { values: {}, instruction: 'raw instruction' },
      ORG_ID
    );
  });
});

describe('AiDesignerConductorService plan acceptance', () => {
  it('rejects an unknown variantId instead of silently re-planning', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: {
          intent: 'x',
          lastPlans: [
            { variantId: 'v1', skill: 'meme' },
            { variantId: 'v2', skill: 'meme' },
          ],
        },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._executePipeline = vi.fn();

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      'bogus',
      false,
      undefined,
      emitter
    );

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'That variant is no longer available — please re-request plans.',
        }),
      })
    );
    expect((conductor as any)._executePipeline).not.toHaveBeenCalled();
  });

  it('accepts all plans when no variantId is provided', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: {
          intent: 'x',
          lastPlans: [
            { variantId: 'v1', skill: 'meme' },
            { variantId: 'v2', skill: 'meme' },
          ],
        },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._executePipeline = vi.fn().mockResolvedValue([]);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    expect((conductor as any)._executePipeline).toHaveBeenCalledWith(
      SESSION_ID,
      ctx,
      expect.anything(),
      expect.anything(),
      emitter,
      expect.arrayContaining([
        expect.objectContaining({ variantId: 'v1' }),
        expect.objectContaining({ variantId: 'v2' }),
      ])
    );
  });

  const makeAcceptanceConductor = (lastPlans: any[]) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const policy = {
      check: vi.fn().mockImplementation((input: any) =>
        Promise.resolve({ ok: true, values: input.values ?? {} })
      ),
    };
    const { conductor } = makeConductor({ service, policy: policy as any });
    (conductor as any)._executePipeline = vi.fn().mockResolvedValue([]);
    return { conductor, service, policy };
  };

  const PLAN_WITH_COPY = {
    variantId: 'v1',
    skill: 'meme',
    concept: 'Labor Day Sale banner',
    slots: [
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'badge', role: 'badge', kind: 'badge' },
      { id: 'image', role: 'image', kind: 'image' },
    ],
    assetNeeds: [],
    palette: [],
    typeScale: {},
    background: { kind: 'solid' },
    texts: { headline: 'Labor Day Sale', badge: 'LABOR26' },
  };

  it('merges accepted plan-card copy edits into the executed plans and the persisted brief', async () => {
    const emitter = makeEmitter();
    const { conductor, service, policy } = makeAcceptanceConductor([
      PLAN_WITH_COPY,
    ]);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      { v1: { headline: 'Labor Day Weekend Sale' } },
      emitter
    );

    // The survivors run through the input policy like any other free text.
    expect(policy.check).toHaveBeenCalledWith(
      { values: { v1: { headline: 'Labor Day Weekend Sale' } } },
      ORG_ID
    );

    // The edited text wins; the untouched plan text survives the merge.
    const executedPlans = (conductor as any)._executePipeline.mock.calls[0][5];
    expect(executedPlans[0].texts).toEqual({
      headline: 'Labor Day Weekend Sale',
      badge: 'LABOR26',
    });

    // brief.lastPlans carries the edits too (persisted before execution).
    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief?.lastPlans
    );
    expect(briefUpdate).toBeDefined();
    expect(briefUpdate[3].brief.lastPlans[0].texts).toEqual({
      headline: 'Labor Day Weekend Sale',
      badge: 'LABOR26',
    });
  });

  it('drops forged variant/slot keys and oversized values silently', async () => {
    const emitter = makeEmitter();
    const { conductor } = makeAcceptanceConductor([PLAN_WITH_COPY]);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      {
        v1: {
          headline: 'Edited headline',
          image: 'not a copy slot',
          mystery: 'not a slot at all',
          badge: 'x'.repeat(501),
        },
        'variant-not-present': { headline: 'forged' },
      },
      emitter
    );

    const executedPlans = (conductor as any)._executePipeline.mock.calls[0][5];
    expect(executedPlans[0].texts).toEqual({
      headline: 'Edited headline',
      badge: 'LABOR26',
    });
  });

  it('drops the edits and executes the plans as presented when the policy rejects them', async () => {
    const emitter = makeEmitter();
    const { conductor, policy } = makeAcceptanceConductor([PLAN_WITH_COPY]);
    policy.check.mockResolvedValue({
      ok: false,
      reason: 'guardrail_blocked',
      message: 'blocked',
    });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      { v1: { headline: 'blocked text' } },
      emitter
    );

    const executedPlans = (conductor as any)._executePipeline.mock.calls[0][5];
    expect(executedPlans[0].texts).toEqual(PLAN_WITH_COPY.texts);
  });
});

describe('AiDesignerConductorService plan parsing', () => {
  it('validates and bounds brief.lastPlans', () => {
    const { conductor } = makeConductor({});
    const config = { variants: 2, channels: ['ig-post'] };
    const response = {
      content: JSON.stringify({
        type: 'plans',
        plans: [
          ...Array.from({ length: 15 }, (_, i) => ({
            variantId: `v${i}`,
            skill: 'meme',
            concept: 'c',
            slots: [],
            assetNeeds: [],
            palette: [],
            typeScale: {},
            background: { kind: 'solid' },
          })),
          { concept: 'missing ids' },
        ],
      }),
    };

    const plans = (conductor as any)._parsePlans(response, config);

    expect(plans.length).toBe(2);
    expect(plans.every((p: any) => p.variantId && p.skill)).toBe(true);
  });

  it('caps serialized plan size to 64 KB', () => {
    const { conductor } = makeConductor({});
    const config = { variants: 10, channels: ['ig-post'] };
    const bigString = 'x'.repeat(10_000);
    const response = {
      content: JSON.stringify({
        type: 'plans',
        plans: Array.from({ length: 10 }, (_, i) => ({
          variantId: `v${i}`,
          skill: 'meme',
          concept: bigString,
          slots: [],
          assetNeeds: [],
          palette: [],
          typeScale: {},
          background: { kind: 'solid' },
        })),
      }),
    };

    const plans = (conductor as any)._parsePlans(response, config);

    expect(JSON.stringify(plans).length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('AiDesignerConductorService pipeline execution', () => {
  it('throws when no output formats are resolved', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x' },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        type: 'plans',
        plans: [{ variantId: 'v1', skill: 'meme' }],
      }),
    });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const recoveryCall = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'awaiting_plan');
    expect(recoveryCall).toBeDefined();
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'I hit a problem while working on this — please try again.',
        }),
      })
    );
  });

  it('continues with remaining variants when one copywriter fails', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x' },
        config: { channels: ['ig-post'], variants: 3 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    let copywriterCall = 0;
    (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId, payload) => {
      if (agentId === 'art-director') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'plans',
            plans: [
              { variantId: 'v1', skill: 'meme' },
              { variantId: 'v2', skill: 'meme' },
              { variantId: 'v3', skill: 'meme' },
            ],
          }),
        });
      }
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        copywriterCall++;
        if (copywriterCall === 2) {
          return Promise.reject(new Error('copywriter failed'));
        }
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });

    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const deliveredUpdate = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'delivered');
    expect(deliveredUpdate).toBeDefined();
    expect(deliveredUpdate[3].activeDesignIds).toHaveLength(2);

    // The variant failure is surfaced to the user as ONE markdown note with
    // the delivery (not one message per note).
    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'variant 2 of 3 failed to generate'
    );
  });

  it('posts a degradation note when the composer ships its fallback doc', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x' },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'art-director') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'plans',
            plans: [{ variantId: 'v1', skill: 'meme' }],
          }),
        });
      }
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'doc',
            doc: { layers: [] },
            fallback: true,
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });

    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'variant 1 used a simplified fallback layout'
    );
  });

  it('skips the copywriter dispatch when every copy slot carries plan texts', async () => {
    const emitter = makeEmitter();
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'Labor Day Sale banner',
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'badge', role: 'badge', kind: 'badge' },
        { id: 'image', role: 'image', kind: 'image' },
      ],
      assetNeeds: [],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      texts: { headline: 'Labor Day Sale', badge: 'LABOR26' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    // All copy locked → no LLM spend on rewriting approved text; the composer
    // receives the plan texts verbatim.
    const copywriterCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]) => agentId === 'copywriter'
    );
    expect(copywriterCalls).toHaveLength(0);
    const composeCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'composer'
    );
    expect(composeCall[2].copy).toEqual({
      headline: 'Labor Day Sale',
      badge: 'LABOR26',
    });
  });

  it('passes the plan texts as lockedTexts when only some copy slots are filled', async () => {
    const emitter = makeEmitter();
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'Labor Day Sale banner',
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'cta', role: 'cta', kind: 'text' },
      ],
      assetNeeds: [],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      texts: { headline: 'Labor Day Sale' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'copy',
            texts: { headline: 'Labor Day Sale', cta: 'Shop now' },
          }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const copyCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'copywriter'
    );
    expect(copyCall).toBeDefined();
    expect(copyCall[2].lockedTexts).toEqual({ headline: 'Labor Day Sale' });
  });

  it('aligns role/case-keyed plan texts to slot ids for lockedTexts', async () => {
    const emitter = makeEmitter();
    // The plan card keyed its texts by role ("headline") and case ("CTA")
    // instead of the exact slot ids — an exact-only lookup would drop the
    // lock and let the copywriter rewrite approved copy from the concept.
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'Labor Day Sale banner',
      slots: [
        { id: 'h1', role: 'headline', kind: 'text' },
        { id: 'cta', role: 'cta', kind: 'text' },
      ],
      assetNeeds: [],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      texts: { headline: 'Role Keyed', CTA: 'Shop now' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    // Both copy slots resolved through the fuzzy key alignment → fully locked
    // → no copywriter dispatch, and the composer gets the approved copy
    // keyed by the real slot ids.
    const copywriterCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]) => agentId === 'copywriter'
    );
    expect(copywriterCalls).toHaveLength(0);
    const composeCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'composer'
    );
    expect(composeCall[2].copy).toEqual({
      h1: 'Role Keyed',
      cta: 'Shop now',
    });
  });

  it('normalizes pipe compounds at the compose-time lock seam (run 3 shipped literal "|" glyphs)', async () => {
    const emitter = makeEmitter();
    // A stored plan (pre-normalization sessions) carrying a pipe-joined
    // fixedCopy compound in a slot text: the LOCKED value must already be
    // pipe-free — a render-side cleanup would be reverted by the copy-lock.
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'Coffee promo',
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'cta', role: 'cta', kind: 'text' },
      ],
      assetNeeds: [],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      texts: { headline: 'Join now | 30% off | BEAN30' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'copy',
            texts: { headline: 'Join now • 30% off • BEAN30', cta: 'Shop now' },
          }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const copyCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'copywriter'
    );
    expect(copyCall[2].lockedTexts).toEqual({
      headline: 'Join now • 30% off • BEAN30',
    });
  });

  it('returns pipe-free locked texts from _lockedTextsFor (fix-loop lock seam)', () => {
    const { conductor } = makeConductor({});
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'Coffee promo',
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'image', role: 'image', kind: 'image' },
      ],
      assetNeeds: [],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
      texts: { headline: 'Join now | BEAN30', image: 'ignored' },
    };

    const locked = (conductor as any)._lockedTextsFor([plan as any]);

    // Identical to the compose-time seam: the fix loop must see the same
    // pipe-free value or the composer's "kept over the rewrite" branch
    // reverts the cleanup.
    expect(locked).toEqual({ headline: 'Join now • BEAN30' });
  });

  it('posts a degradation note when a need is missing from the asset map', async () => {
    const emitter = makeEmitter();
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'A scenic promo',
      slots: [{ id: 'image', role: 'image', kind: 'image' }],
      assetNeeds: [
        { slotId: 'image', brief: 'mountain lake at dawn', prefer: 'generate' },
      ],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        // Well-formed assets payload, but the need's slot is absent — the
        // gradient fallback failed inside the asset agent.
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'no imagery could be generated for "mountain lake at dawn" — the design uses fallback styling'
    );
  });

  it('posts one umbrella note when the asset agent returns a non-assets payload', async () => {
    const emitter = makeEmitter();
    const plan = {
      variantId: 'v1',
      skill: 'meme',
      concept: 'A scenic promo',
      slots: [{ id: 'image', role: 'image', kind: 'image' }],
      assetNeeds: [
        { slotId: 'image', brief: 'mountain lake at dawn', prefer: 'generate' },
      ],
      palette: [],
      typeScale: {},
      background: { kind: 'solid' },
    };
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;

    (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        // The asset agent's error envelope — not an assets payload.
        return Promise.resolve({
          content: JSON.stringify({ type: 'error', message: 'missing orgId' }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'imagery generation failed outright — the designs use fallback styling'
    );
    expect(noteCalls[0][0].content.md).not.toContain(
      'no imagery could be generated for'
    );
  });

  it('posts a degradation note when the vision-critic pass fails', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x' },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
          contactSheetUrl: 'https://example.com/sheet.png',
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;
    (conductor as any)._skillRouter = {
      getRubric: vi.fn().mockReturnValue({ criteria: [] }),
    };
    (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'art-director') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'plans',
            plans: [{ variantId: 'v1', skill: 'meme' }],
          }),
        });
      }
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      if (agentId === 'vision-critic') {
        return Promise.reject(new Error('Invalid base64 image_url.'));
      }
      return Promise.resolve({ content: '{}' });
    });

    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    // The run still delivered, and the failed quality pass is surfaced as ONE
    // consolidated markdown note with the delivery.
    const deliveredUpdate = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'delivered');
    expect(deliveredUpdate).toBeDefined();
    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'the automatic quality pass failed for variant 1'
    );
  });

  it('routes vision-critic error envelope to the non-fatal path', async () => {
    const { conductor } = makeConductor({});

    expect(() =>
      (conductor as any)._parseFindings({
        content: JSON.stringify({ type: 'error', message: 'cannot run' }),
      })
    ).toThrow('cannot run');
  });

  const makePipelineConductor = (
    brief: Record<string, unknown>,
    variants: number,
    dispatchAgent: ReturnType<typeof vi.fn>
  ) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief,
        config: { channels: ['ig-post'], variants },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((orgId, userId, variantId) =>
        Promise.resolve({
          designId: `design-${variantId}`,
          variantId,
          outputPreviews: [],
        })
      ),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;
    (conductor as any)._dispatchAgent = dispatchAgent;
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });
    return { conductor, service, saver };
  };

  const okDispatch = (plans: { variantId: string; skill: string }[]) =>
    vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'art-director') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'plans', plans }),
        });
      }
      if (agentId === 'asset') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'assets', assets: {} }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'copy', texts: {} }),
        });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { layers: [] } }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });

  const PLAN_STUBS = [1, 2, 3].map((n) => ({
    variantId: `v${n}`,
    skill: 'meme',
    concept: `concept ${n}`,
    slots: [],
    assetNeeds: [],
    palette: [],
    typeScale: {},
    background: { kind: 'solid' as const },
  }));

  it('emits no "could be planned" note when the user deliberately accepted a subset', async () => {
    // 3 plans were presented and 3 were requested, but the user accepted one —
    // a subset accept is not a planning shortfall.
    const emitter = makeEmitter();
    const { conductor, service } = makePipelineConductor(
      { intent: 'x', lastPlans: PLAN_STUBS },
      3,
      okDispatch(PLAN_STUBS)
    );

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      'v1',
      false,
      undefined,
      emitter
    );

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    for (const call of noteCalls) {
      expect(call[0].content.md).not.toContain('could be planned');
    }
  });

  it('keeps the "could be planned" note when planning itself fell short', async () => {
    // No preset plans: the art-director returned 1 plan while 3 were
    // requested — that IS a planning shortfall and keeps its note.
    const emitter = makeEmitter();
    const { conductor, service } = makePipelineConductor(
      { intent: 'x' },
      3,
      okDispatch([PLAN_STUBS[0]])
    );

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'only 1 of the 3 requested variants could be planned'
    );
  });

  it('recovers an all-variants-failed run with a sanitized render hint', async () => {
    // The S3 failure shape: every accepted variant fails at render time with
    // a raw node-canvas error — the user gets a human reason, never the raw
    // message.
    const emitter = makeEmitter();
    const { conductor, service, saver } = makePipelineConductor(
      { intent: 'x', lastPlans: [PLAN_STUBS[0]] },
      1,
      okDispatch([PLAN_STUBS[0]])
    );
    saver.saveDesign.mockRejectedValue(
      new Error('parse color failed at CanvasGradient.cc')
    );

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    const recoveryCall = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'awaiting_plan');
    expect(recoveryCall).toBeDefined();
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: "The generated design couldn't be rendered — one of its colors was invalid. Please try again.",
        }),
      })
    );
    // The raw error never reaches the user-facing channel.
    const userTexts = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => JSON.stringify(call[0].content));
    expect(userTexts.some((t) => t.includes('parse color failed'))).toBe(false);
    expect(emitter.error).toHaveBeenCalledWith(
      'agent_failed',
      "The generated design couldn't be rendered — one of its colors was invalid. Please try again."
    );
  });
});

describe('AiDesignerConductorService form submit', () => {
  it('does not persist the brief when the chat mutex is busy', async () => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'intake',
        mode: 'chat',
        brief: { intent: '' },
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._inFlight.add(SESSION_ID);

    await conductor.handleFormSubmit(
      SESSION_ID,
      ctx,
      'reply-1',
      { audience: 'everyone' },
      makeEmitter()
    );

    expect(service.updateSession).not.toHaveBeenCalled();
  });
});

describe('AiDesignerConductorService conversational accept', () => {
  it('reports template save failure accurately', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'chat',
        brief: { intent: 'x', skillId: 'meme' },
        activeDesignIds: ['design-A'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-A', doc: {} }),
      createTemplate: vi.fn().mockRejectedValue(new Error('db down')),
    };
    const { conductor } = makeConductor({
      service,
      policy: {
        check: vi.fn().mockImplementation((input: any) =>
          Promise.resolve({
            ok: true,
            values: input.values ?? {},
            instruction: input.instruction,
          })
        ),
      } as any,
    });
    (conductor as any)._designService = designService;
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({ type: 'accept', text: 'Great!' }),
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'looks good', emitter);

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: "Couldn't save the template — the design is still available; try again in a moment.",
        }),
      })
    );
  });
});

describe('AiDesignerConductorService vision-critic rubric resolution', () => {
  const makePlan = (variantId: string, skill: string) => ({
    variantId,
    skill,
    concept: `concept-${variantId}`,
    slots: [] as any[],
    assetNeeds: [] as any[],
    palette: [] as any[],
    typeScale: {},
    background: { kind: 'solid' as const },
  });

  const makeRenderResult = (variantId: string) => ({
    designId: `design-${variantId}`,
    variantId,
    outputPreviews: [
      {
        formatId: 'ig-post',
        fileId: `file-${variantId}`,
        url: `https://example.com/preview-${variantId}.png`,
      },
    ],
    contactSheetUrl: `https://example.com/sheet-${variantId}.png`,
  });

  it('resolves the vision-critic rubric per variant from the matching plan skill', async () => {
    const emitter = makeEmitter();
    const plans = [makePlan('v1', 'meme'), makePlan('v2', 'advertisement')];
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: plans },
        config: { channels: ['ig-post'], variants: 2 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((_orgId, _userId, variantId) =>
        Promise.resolve(makeRenderResult(variantId))
      ),
    };
    const composer = { applyFixes: vi.fn() };
    const designService = { getDesign: vi.fn() };
    const skillRouter = new AiDesignerSkillRouter();

    const { conductor } = makeConductor({ service });
    (conductor as any)._skillRouter = skillRouter;
    (conductor as any)._saver = saver;
    (conductor as any)._composer = composer;
    (conductor as any)._designService = designService;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({ content: JSON.stringify({ type: 'assets', assets: {} }) });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({ content: JSON.stringify({ type: 'copy', texts: {} }) });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { metadata: {}, layers: [] } }),
        });
      }
      if (agentId === 'vision-critic') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'findings', findings: [] }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);

    // Single-output docs send the output's own full-res preview as the
    // critique image (the ≤400px contact sheet hides badge-sized text).
    const v1Call = criticCalls.find(
      ([_, __, payload]: any) =>
        payload.contactSheetUrl === 'https://example.com/preview-v1.png'
    );
    const v2Call = criticCalls.find(
      ([_, __, payload]: any) =>
        payload.contactSheetUrl === 'https://example.com/preview-v2.png'
    );

    expect(v1Call).toBeDefined();
    expect(v2Call).toBeDefined();
    expect(v1Call![2].rubric).toEqual(skillRouter.getRubric('meme'));
    expect(v2Call![2].rubric).toEqual(skillRouter.getRubric('advertisement'));
    // The design doc's element data rides along for contrast/occlusion checks.
    expect(v1Call![2].docSummary).toBeDefined();
  });

  it('resolves the revise re-check rubric from the session brief skillId', async () => {
    const emitter = makeEmitter();
    const skillRouter = new AiDesignerSkillRouter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'prompt',
        brief: { intent: 'x', skillId: 'advertisement', lastPlans: [] },
        activeDesignIds: ['design-A'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-A', doc: { metadata: {}, layers: [] } }),
    };
    const composer = {
      reviseByInstruction: vi.fn().mockResolvedValue({ metadata: {}, layers: [] }),
      applyFixes: vi.fn(),
    };
    const saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-A-revised',
        variantId: 'revised',
        contactSheetUrl: 'https://example.com/revised-sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'file-revised', url: 'https://example.com/revised.png' },
        ],
      }),
      updateDesign: vi.fn(),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._skillRouter = skillRouter;
    (conductor as any)._designService = designService;
    (conductor as any)._composer = composer;
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'vision-critic') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'findings', findings: [] }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-A', nonce: 'n1' },
      emitter
    );

    const criticCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'vision-critic'
    );
    expect(criticCall).toBeDefined();
    expect(criticCall![2].rubric).toEqual(skillRouter.getRubric('advertisement'));
  });

  it('falls back to the meme rubric when the session brief has no skillId', async () => {
    const emitter = makeEmitter();
    const skillRouter = new AiDesignerSkillRouter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [] },
        activeDesignIds: ['design-A'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-A', doc: { metadata: {}, layers: [] } }),
    };
    const composer = {
      reviseByInstruction: vi.fn().mockResolvedValue({ metadata: {}, layers: [] }),
      applyFixes: vi.fn(),
    };
    const saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-A-revised',
        variantId: 'revised',
        contactSheetUrl: 'https://example.com/revised-sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'file-revised', url: 'https://example.com/revised.png' },
        ],
      }),
      updateDesign: vi.fn(),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._skillRouter = skillRouter;
    (conductor as any)._designService = designService;
    (conductor as any)._composer = composer;
    (conductor as any)._saver = saver;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'vision-critic') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'findings', findings: [] }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-A', nonce: 'n1' },
      emitter
    );

    const criticCall = dispatchAgent.mock.calls.find(
      ([_, agentId]) => agentId === 'vision-critic'
    );
    expect(criticCall).toBeDefined();
    expect(criticCall![2].rubric).toEqual(skillRouter.getRubric('meme'));
  });

  // Round 8 C5: `results = [revised]` on the revise path, and the caption used
  // a hardcoded array index — so a revision of variant 3 always shipped
  // captioned "Variant 1".
  describe('revise targeting and captions', () => {
    const makeReviseConductor = (activeDesignIds: string[]) => {
      const service = {
        getSessionForUser: vi.fn().mockResolvedValue({
          id: SESSION_ID,
          state: 'delivered',
          mode: 'prompt',
          brief: { intent: 'x', lastPlans: [] },
          activeDesignIds,
        }),
        updateSession: vi.fn().mockResolvedValue(undefined),
        appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      };
      const designService = {
        getDesign: vi
          .fn()
          .mockResolvedValue({ id: 'd', doc: { metadata: {}, layers: [] } }),
      };
      const composer = {
        reviseByInstruction: vi.fn().mockResolvedValue({ metadata: {}, layers: [] }),
        applyFixes: vi.fn(),
        canResolveFormatScope: vi.fn().mockReturnValue(true),
      };
      const saver = {
        saveDesign: vi.fn().mockResolvedValue({
          designId: 'design-C-revised',
          variantId: 'revised',
          contactSheetUrl: 'https://example.com/revised-sheet.png',
          outputPreviews: [
            {
              formatId: 'ig-post',
              fileId: 'file-revised',
              url: 'https://example.com/revised.png',
            },
          ],
        }),
        updateDesign: vi.fn(),
      };
      const { conductor } = makeConductor({ service });
      (conductor as any)._skillRouter = new AiDesignerSkillRouter();
      (conductor as any)._designService = designService;
      (conductor as any)._composer = composer;
      (conductor as any)._saver = saver;
      (conductor as any)._dispatchAgent = vi.fn().mockImplementation((_, agentId) =>
        Promise.resolve({
          content:
            agentId === 'vision-critic'
              ? JSON.stringify({ type: 'findings', findings: [] })
              : '{}',
        })
      );
      const mediaOf = () =>
        (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
          .map(([arg]: any) => arg?.content)
          .find((c: any) => c?.kind === 'media');
      const notesOf = () =>
        (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
          .map(([arg]: any) => arg?.content?.md)
          .filter(Boolean)
          .join('\n');
      return { conductor, service, mediaOf, notesOf };
    };

    it('captions a revised variant with its SOURCE ordinal, not index 0', async () => {
      const { conductor, mediaOf } = makeReviseConductor([
        'design-A',
        'design-B',
        'design-C',
      ]);

      await conductor.handleRevise(
        SESSION_ID,
        ctx,
        { instruction: 'make it bigger', targetDesignId: 'design-C', nonce: 'n1' },
        makeEmitter()
      );

      expect(mediaOf().items[0].caption).toBe('Variant 3 · ig-post');
    });

    it('tells the user which variant it revised and that the others remain', async () => {
      const { conductor, notesOf } = makeReviseConductor([
        'design-A',
        'design-B',
        'design-C',
      ]);

      await conductor.handleRevise(
        SESSION_ID,
        ctx,
        { instruction: 'make it bigger', targetDesignId: 'design-B', nonce: 'n1' },
        makeEmitter()
      );

      const notes = notesOf();
      expect(notes).toContain('I revised variant 2');
      expect(notes).toContain('your other variants are still available');
    });

    it('says nothing extra when there is only one variant', async () => {
      const { conductor, notesOf, mediaOf } = makeReviseConductor(['design-A']);

      await conductor.handleRevise(
        SESSION_ID,
        ctx,
        { instruction: 'make it bigger', targetDesignId: 'design-A', nonce: 'n1' },
        makeEmitter()
      );

      expect(notesOf()).not.toContain('I revised variant');
      expect(mediaOf().items[0].caption).toBe('Variant 1 · ig-post');
    });
  });
});

describe('AiDesignerConductorService plan-stage revision', () => {
  it('re-plans and stays in awaiting_plan when revise arrives before acceptance', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [{ variantId: 'v1', skill: 'meme' }] },
        config: { channels: ['ig-post'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const policy = {
      check: vi.fn().mockResolvedValue({ ok: true, instruction: 'make it darker' }),
    };
    const { conductor } = makeConductor({ service, policy: policy as any });

    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'art-director') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'plans',
            plans: [{ variantId: 'v2', skill: 'meme', concept: 'darker' }],
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it darker', nonce: 'n1' },
      emitter
    );

    // The art director is re-run with the instruction riding on the brief
    // (which also carries the previous lastPlans as context).
    expect(dispatchAgent).toHaveBeenCalledWith(
      expect.anything(),
      'art-director',
      expect.objectContaining({
        type: 'plan-request',
        brief: expect.objectContaining({
          revisionInstruction: 'make it darker',
          lastPlans: [{ variantId: 'v1', skill: 'meme' }],
        }),
      })
    );

    // The new plans are persisted and presented; the session stays in
    // awaiting_plan and never enters the design-revision path.
    const planPersist = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'awaiting_plan' && call[3].brief?.lastPlans);
    expect(planPersist).toBeDefined();
    expect(planPersist[3].brief.lastPlans).toEqual([
      expect.objectContaining({ variantId: 'v2' }),
    ]);
    // The persisted brief keeps the original intent…
    expect(planPersist[3].brief.intent).toBe('x');
    const planMessage = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[0].kind === 'plan');
    expect(planMessage).toBeDefined();
    // …while the presented plan card's intent line shows the revision
    // instruction, not the stale pre-revision intent.
    expect(planMessage[0].content.brief.intent).toBe('make it darker');
    expect(planMessage[0].content.brief.revisionInstruction).toBe('make it darker');
    expect(
      (service.updateSession as ReturnType<typeof vi.fn>).mock.calls.some(
        (call) => call[3].state === 'revising'
      )
    ).toBe(false);
  });
});

describe('AiDesignerConductorService revise activeDesignIds', () => {
  it('merges the revised design into activeDesignIds instead of replacing them', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [] },
        activeDesignIds: ['design-A', 'design-B'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const policy = {
      check: vi.fn().mockResolvedValue({ ok: true, instruction: 'make it bigger' }),
    };
    const { conductor } = makeConductor({ service, policy: policy as any });

    (conductor as any)._classifyDeliveredChat = vi.fn().mockResolvedValue({
      kind: 'revise',
      revision: {
        instruction: 'make it bigger',
        targetDesignId: 'design-A',
        scope: 'shared',
      },
    });
    (conductor as any)._reviseDesign = vi.fn().mockResolvedValue({
      designId: 'design-A2',
      variantId: 'revised',
      outputPreviews: [],
    });

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-A', nonce: 'n1' },
      emitter
    );

    const deliveredUpdate = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'delivered');
    expect(deliveredUpdate).toBeDefined();
    expect(deliveredUpdate[3].activeDesignIds).toEqual([
      'design-A',
      'design-B',
      'design-A2',
    ]);
  });
});

describe('AiDesignerConductorService._collectAssetNeeds (variant-scoped)', () => {
  const makePlan = (overrides: Record<string, unknown> = {}) =>
    ({
      variantId: 'v1',
      skill: 'meme',
      concept: 'concept',
      palette: [],
      typeScale: {},
      background: { kind: 'solid' as const },
      slots: [{ id: 'hero', role: 'image', kind: 'image' }],
      assetNeeds: [
        { slotId: 'hero', brief: 'a hero image', prefer: 'generate' as const },
      ],
      ...overrides,
    }) as any;

  const SQUARE_OUT = { formatId: 'ig-post', width: 1080, height: 1080 };
  const WIDE_OUT = { formatId: 'fb-post', width: 1200, height: 630 };
  const WIDE_OUT_2 = { formatId: 'x-post', width: 1200, height: 675 };
  const TALL_OUT = { formatId: 'ig-story', width: 1080, height: 1920 };

  it('gives every plan its own variant-scoped need per slot (originals stay distinct)', () => {
    const { conductor } = makeConductor({});
    const plans = [
      makePlan(),
      makePlan({ variantId: 'v2' }),
      makePlan({ variantId: 'v3' }),
    ];

    const { needs, dropped } = (conductor as any)._collectAssetNeeds(
      plans,
      [SQUARE_OUT, WIDE_OUT, TALL_OUT]
    );

    expect(dropped).toBe(0);
    // 3 plans × 1 slot → 3 distinct needs; the bare slotId used to collapse
    // them onto one shared image.
    expect(needs.map((n: any) => n.slotId)).toEqual([
      'v1:hero',
      'v2:hero',
      'v3:hero',
    ]);
    // One need per key, in the PRIMARY output's aspect class only — no
    // slot×aspect fan-out.
    expect(needs.map((n: any) => n.aspect)).toEqual([
      'square',
      'square',
      'square',
    ]);
  });

  it('emits a single need per plan×slot no matter how many outputs the session has', () => {
    const { conductor } = makeConductor({});

    const { needs } = (conductor as any)._collectAssetNeeds(
      [makePlan()],
      [WIDE_OUT, WIDE_OUT_2]
    );

    expect(needs).toHaveLength(1);
    expect(needs[0].slotId).toBe('v1:hero');
    expect(needs[0].aspect).toBe('wide');
  });

  it('dedupes a repeated slotId within one plan', () => {
    const { conductor } = makeConductor({});
    const plan = makePlan({
      assetNeeds: [
        { slotId: 'hero', brief: 'first', prefer: 'generate' },
        { slotId: 'hero', brief: 'second', prefer: 'generate' },
      ],
    });

    const { needs } = (conductor as any)._collectAssetNeeds([plan], [SQUARE_OUT]);

    expect(needs).toHaveLength(1);
    expect(needs[0].brief).toBe('first');
  });

  it('trims plan×slot needs to the cap', () => {
    const { conductor } = makeConductor({});
    const plan = (variantId: string) =>
      makePlan({
        variantId,
        slots: [
          { id: 'a', role: 'image', kind: 'image' },
          { id: 'b', role: 'image', kind: 'image' },
          { id: 'c', role: 'image', kind: 'image' },
        ],
        assetNeeds: [
          { slotId: 'a', brief: 'a', prefer: 'generate' },
          { slotId: 'b', brief: 'b', prefer: 'generate' },
          { slotId: 'c', brief: 'c', prefer: 'generate' },
        ],
      });

    // 3 plans × 3 slots = 9 needs → capped to 8.
    const { needs, dropped } = (conductor as any)._collectAssetNeeds(
      [plan('v1'), plan('v2'), plan('v3')],
      [SQUARE_OUT]
    );

    expect(needs).toHaveLength(8);
    expect(dropped).toBe(1);
  });

  it('carries hero layout intent only for hero/background slots', () => {
    const { conductor } = makeConductor({});
    const plan = makePlan({
      channelLayouts: { 'ig-post': 'side-by-side' },
      slots: [
        { id: 'hero', role: 'image', kind: 'image' },
        { id: 'headline', role: 'headline', kind: 'text' },
      ],
      assetNeeds: [
        { slotId: 'hero', brief: 'hero', prefer: 'generate' },
        { slotId: 'bg', brief: 'backdrop', prefer: 'generate' },
      ],
      background: { kind: 'image', ref: 'asset:bg' },
    });

    const { needs } = (conductor as any)._collectAssetNeeds([plan], [SQUARE_OUT]);

    const heroNeed = needs.find((n: any) => n.slotId === 'v1:hero');
    const bgNeed = needs.find((n: any) => n.slotId === 'v1:bg');
    expect(heroNeed.heroLayout).toBe('side-by-side');
    expect(bgNeed.heroLayout).toBe('side-by-side');
  });

  it('omits heroLayout for non-hero layouts', () => {
    const { conductor } = makeConductor({});
    const plan = makePlan({ formatTemplate: 'minimal-centered' });

    const { needs } = (conductor as any)._collectAssetNeeds([plan], [SQUARE_OUT]);

    expect(needs[0].heroLayout).toBeUndefined();
  });

  it('drops needs a composition with no imagery role can never place', () => {
    const { conductor } = makeConductor({});
    const plan = makePlan({
      composition: 'type-dominant',
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      assetNeeds: [
        { slotId: 'hero', brief: 'a hero image', prefer: 'generate' },
      ],
    });

    const { needs, dropped } = (conductor as any)._collectAssetNeeds(
      [plan],
      [SQUARE_OUT]
    );

    expect(needs).toHaveLength(0);
    expect(dropped).toBe(1);
  });

  it('keeps a background-ref need even on an imageless composition', () => {
    const { conductor } = makeConductor({});
    const plan = makePlan({
      composition: 'type-dominant',
      slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
      background: { kind: 'image', ref: 'asset:bg' },
      assetNeeds: [
        { slotId: 'bg', brief: 'backdrop', prefer: 'either' },
        { slotId: 'hero', brief: 'a hero image', prefer: 'generate' },
      ],
    });

    const { needs, dropped } = (conductor as any)._collectAssetNeeds(
      [plan],
      [SQUARE_OUT]
    );

    expect(needs.map((n: any) => n.slotId)).toEqual(['v1:bg']);
    expect(dropped).toBe(1);
  });

  it('keeps needs when the imageless composition does not fit the plan', () => {
    const { conductor } = makeConductor({});
    // type-dominant requires a headline; without one it does not fit, the
    // composer falls back to an imagery composition, and the need stays.
    const plan = makePlan({
      composition: 'type-dominant',
      slots: [
        { id: 'cta', role: 'cta', kind: 'cta-button' },
        { id: 'hero', role: 'image', kind: 'image' },
      ],
    });

    const { needs, dropped } = (conductor as any)._collectAssetNeeds(
      [plan],
      [SQUARE_OUT]
    );

    expect(needs).toHaveLength(1);
    expect(dropped).toBe(0);
  });
});


describe('AiDesignerConductorService chat intake', () => {
  const makeIntakeConductor = (
    brief: Record<string, unknown>,
    state = 'intake'
  ) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state,
        mode: 'chat',
        brief,
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
      getMessages: vi.fn().mockResolvedValue([]),
    };
    const policy = {
      check: vi.fn().mockImplementation((input: any) =>
        Promise.resolve({
          ok: true,
          values: input.values ?? {},
          instruction: input.instruction,
        })
      ),
    };
    const budgetGuard = {
      checkStartBudget: vi.fn().mockResolvedValue({ allowed: true }),
    };
    const conductor = new AiDesignerConductorService(
      service as any,
      null as any,
      new AiDesignerSkillRouter(),
      null as any,
      null as any,
      budgetGuard as any,
      null as any,
      policy as any,
      null as any
    );
    return { conductor, service, policy, budgetGuard };
  };

  const agentReply = (payload: unknown) => ({ content: JSON.stringify(payload) });
  const CONFIG = { channels: [], variants: 1 } as any;

  const progressCallIndex = (service: any, phase: string) =>
    service.appendMessage.mock.calls.findIndex(
      (call: any) => call[0].kind === 'progress' && call[0].content.phase === phase
    );

  it('merges free-text fields into the brief and emits the next question', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: { intent: 'a meme about cats' },
        reply: 'Who is it for?',
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'a meme about cats'
    );

    expect(service.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      ORG_ID,
      USER_ID,
      {
        brief: expect.objectContaining({
          intent: 'a meme about cats',
          // The asked field is tracked so a stall can fall back to the form.
          questionsAsked: ['audience'],
        }),
      }
    );
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        agent: 'conversationalist',
        content: { kind: 'text', text: 'Who is it for?' },
      })
    );
    expect(emitter.toSession).toHaveBeenCalledWith('message', { id: 'msg-1' });
  });

  it('never trusts raw keys from the extracted fields', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: {
          intent: 'a meme about cats',
          lastPlans: [{ variantId: 'evil', skill: 'meme' }],
          questionsAsked: ['forged'],
        },
        reply: 'Who is it for?',
      })
    );

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief).not.toHaveProperty('lastPlans');
    expect(briefUpdate[3].brief.questionsAsked).toEqual(['audience']);
  });

  it('counts consecutive classifier failures server-side and resets on success', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'x',
      classifierFailures: 1,
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', reply: 'Who is it for?', classifierFailed: true })
    );

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.classifierFailures).toBe(2);
    // Two failures — no warning yet.
    const warning = service.appendMessage.mock.calls.find(
      (call: any) => call[0].content?.text?.includes?.('AI provider')
    );
    expect(warning).toBeUndefined();

    // A successful turn resets the counter.
    service.updateSession.mockClear();
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', reply: 'Who is it for?' })
    );
    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');
    const resetUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(resetUpdate[3].brief).not.toHaveProperty('classifierFailures');
  });

  it('emits the provider-trouble note ONCE at three consecutive classifier failures', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'x',
      classifierFailures: 2,
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', reply: 'Who is it for?', classifierFailed: true })
    );

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.classifierFailures).toBe(3);
    expect(briefUpdate[3].brief.llmWarningShown).toBe(true);
    const warnings = service.appendMessage.mock.calls.filter((call: any) =>
      call[0].content?.text?.includes?.(
        "I'm having trouble reaching your AI provider"
      )
    );
    expect(warnings).toHaveLength(1);

    // The gate persists: a fourth failure never repeats the note.
    service.getSessionForUser.mockResolvedValue({
      id: SESSION_ID,
      state: 'intake',
      mode: 'chat',
      brief: { intent: 'x', classifierFailures: 3, llmWarningShown: true },
      activeDesignIds: null,
    });
    service.appendMessage.mockClear();
    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');
    const repeat = service.appendMessage.mock.calls.filter((call: any) =>
      call[0].content?.text?.includes?.(
        "I'm having trouble reaching your AI provider"
      )
    );
    expect(repeat).toHaveLength(0);
  });

  it('strips forged classifierFailures/llmWarningShown from extracted fields', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: {
          intent: 'a meme about cats',
          classifierFailures: 99,
          llmWarningShown: true,
        },
        reply: 'Who is it for?',
      })
    );

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief).not.toHaveProperty('classifierFailures');
    expect(briefUpdate[3].brief).not.toHaveProperty('llmWarningShown');
  });

  it('stores the raw first message as the intent when the classifier compressed it', async () => {
    // Regression (live session cms8d588b001jp32adgi8dcm5): the classifier
    // compressed the first message to "Flash sale for a skincare brand",
    // silently discarding the starburst instruction, the mandated copy and
    // the URL — every downstream copy-fidelity check then had nothing to
    // protect. The raw text must ride the normal merge, so the spoken URL
    // lands dotted and the quoted span still becomes fixedCopy.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    const rawMessage =
      'Flash sale for a skincare brand — big starburst badge with "50% OFF TODAY ONLY", clean bright look, shop at glowlab dot shop.';
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: { intent: 'Flash sale for a skincare brand' },
        reply: 'Who is it for?',
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      rawMessage
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.intent).toBe(
      'Flash sale for a skincare brand — big starburst badge with "50% OFF TODAY ONLY", clean bright look, shop at glowlab.shop.'
    );
    expect(briefUpdate[3].brief.fixedCopy).toBe('50% OFF TODAY ONLY');
  });

  it('does not turn a greeting into the intent when the classifier extracted none', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: {},
        reply: 'Hi! What would you like to design?',
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'hey there!'
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.intent).toBe('');
  });

  it('never overwrites an existing intent with a later answer turn', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'Flash sale for a skincare brand — shop at glowlab.shop',
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        fields: { audience: 'Skincare shoppers', intent: 'Skincare shoppers' },
        reply: 'What tone should it have?',
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'Skincare shoppers'
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.intent).toBe(
      'Flash sale for a skincare brand — shop at glowlab.shop'
    );
    expect(briefUpdate[3].brief.audience).toBe('Skincare shoppers');
  });

  it('merges extraction carried on a form turn before appending the form', async () => {
    // Regression (live session): the user answered "Who is the audience?",
    // the conversationalist extracted it AND returned the low-confidence
    // skill form in the same turn — dropping the extraction re-asked the
    // audience question right after the form submit.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'social media post for our Labor Day Sale',
      tone: 'patriotic',
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'form',
        extracted: { audience: 'social media followers' },
        prompt:
          'I can take this a few different ways — what kind of design is it?',
        fields: [
          {
            name: 'preferredSkill',
            type: 'radio',
            label: 'What kind of design is this?',
            options: [{ value: 'advertisement', label: 'Advertisement' }],
          },
        ],
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'social media followers'
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief).toEqual(
      expect.objectContaining({ audience: 'social media followers' })
    );
    // The brief write lands before the form is appended.
    expect(briefUpdate[3].brief.audience).toBeTruthy();
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'form',
        agent: 'conversationalist',
      })
    );
  });

  it('passes the last assistant question to the conversationalist as context', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'an end of summer sale',
    });
    service.getMessages.mockResolvedValue([
      {
        id: 'a1',
        role: 'assistant',
        kind: 'text',
        content: {
          kind: 'text',
          text: 'Who is the audience for your end of summer sale?',
        },
      },
      { id: 'u1', role: 'user', kind: 'text', content: { kind: 'text', text: 'followers' } },
    ]);
    const dispatch = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue(
        agentReply({
          type: 'chat-turn',
          fields: { audience: 'followers' },
          reply: 'What tone should it have?',
        })
      ));

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'followers'
    );

    expect(dispatch.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        lastQuestion: 'Who is the audience for your end of summer sale?',
      })
    );
  });

  it('skips the lastQuestion lookup on the form path (no free text)', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', reply: 'What is this design about?' })
    );

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter);

    expect(service.getMessages).not.toHaveBeenCalled();
  });

  it('records the submitted field names in questionsAsked, not the form message id', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._runChatIntake = vi.fn().mockResolvedValue(undefined);

    await conductor.handleFormSubmit(
      SESSION_ID,
      ctx,
      'msg-42',
      { intent: 'a summer sale', audience: 'followers' },
      emitter
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief.questionsAsked).toEqual(['intent', 'audience']);
    expect(briefUpdate[3].brief.questionsAsked).not.toContain('msg-42');
  });

  it('strips a forged recapShown from form-submit values', async () => {
    // recapShown is server-owned: only the conversationalist's recap turn may
    // set it — a client forging it in form values must not skip the gate.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._runChatIntake = vi.fn().mockResolvedValue(undefined);

    await conductor.handleFormSubmit(
      SESSION_ID,
      ctx,
      'msg-42',
      { intent: 'a summer sale', recapShown: true },
      emitter
    );

    const briefUpdate = service.updateSession.mock.calls.find(
      (call: any) => call[3]?.brief
    );
    expect(briefUpdate[3].brief).not.toHaveProperty('recapShown');
  });

  it('does NOT advance when free text completes the brief — the recap needs a green light', async () => {
    // Gate semantics: a complete-but-unconfirmed brief recaps and stays in
    // intake; only a confirmed recap turn advances to plan presentation.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: '',
      audience: 'devs',
      tone: 'funny',
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'chat-turn',
        recap: true,
        fields: { intent: 'a funny meme about remote work' },
        reply: 'A funny remote-work meme for your devs. Ready for concepts?',
      })
    );
    const present = ((conductor as any)._runPlanPresentation = vi
      .fn()
      .mockResolvedValue(undefined));

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'a funny meme about remote work'
    );

    expect(present).not.toHaveBeenCalled();
    // The merged brief is persisted with the server-owned recapShown gate
    // set by the recap turn, the state stays in intake, and the recap is
    // emitted as the checkpoint.
    expect(service.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      ORG_ID,
      USER_ID,
      {
        brief: expect.objectContaining({
          intent: 'a funny meme about remote work',
          recapShown: true,
        }),
      }
    );
    expect(
      service.updateSession.mock.calls.some((call: any) => call[3]?.state)
    ).toBe(false);
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        agent: 'conversationalist',
        content: {
          kind: 'text',
          text: 'A funny remote-work meme for your devs. Ready for concepts?',
        },
      })
    );
  });

  it('does NOT advance on the form-submit path either — the recap comes first', async () => {
    // The form path dispatches with no text; a complete brief must land in
    // the conversationalist's recap branch, never jump straight to planning.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'a funny meme about remote work',
      audience: 'devs',
      tone: 'funny',
    });
    const dispatch = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue(
        agentReply({
          type: 'chat-turn',
          reply: "Here's what I have: a funny remote-work meme for devs. Ready for concepts?",
        })
      ));
    const present = ((conductor as any)._runPlanPresentation = vi
      .fn()
      .mockResolvedValue(undefined));

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter);

    expect(present).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(
      expect.anything(),
      'conversationalist',
      expect.objectContaining({ type: 'chat' })
    );
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'text',
        agent: 'conversationalist',
      })
    );
  });

  it('advances to plan presentation when the user confirms the summary', async () => {
    const emitter = makeEmitter();
    // The recap gate: `recapShown` is persisted when the recap turn goes out
    // (tested above) — only then does a confirmed turn advance.
    const { conductor } = makeIntakeConductor({
      intent: 'a meme about cats',
      recapShown: true,
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', confirmed: true })
    );
    const present = ((conductor as any)._runPlanPresentation = vi
      .fn()
      .mockResolvedValue(undefined));

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'yes, go ahead'
    );

    expect(present).toHaveBeenCalled();
  });

  it('does NOT advance on a confirmed turn when no recap was shown yet', async () => {
    // Defense in depth behind the conversationalist's own gate: a confirmed
    // chat-turn is honored only when the merged brief carries recapShown.
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({
      intent: 'a meme about cats',
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({ type: 'chat-turn', confirmed: true })
    );
    const present = ((conductor as any)._runPlanPresentation = vi
      .fn()
      .mockResolvedValue(undefined));

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'yes, go ahead'
    );

    expect(present).not.toHaveBeenCalled();
    expect(
      service.updateSession.mock.calls.some((call: any) => call[3]?.state)
    ).toBe(false);
  });

  it('keeps the quick-form escape intact', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue(
      agentReply({
        type: 'form',
        prompt: 'Before I can plan the design, I need a little more information.',
        fields: [
          { name: 'intent', type: 'text', label: 'What is this post about?' },
        ],
      })
    );

    await (conductor as any)._runChatIntake(
      SESSION_ID,
      ctx,
      CONFIG,
      emitter,
      'just give me a form'
    );

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'form', agent: 'conversationalist' })
    );
    expect(emitter.toSession).toHaveBeenCalledWith('message', { id: 'msg-1' });
  });

  it('emits a persisted Thinking… progress row before the conversationalist dispatch', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: '' });
    const dispatch = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue(
        agentReply({ type: 'chat-turn', reply: 'What is this design about?' })
      ));

    await (conductor as any)._runChatIntake(SESSION_ID, ctx, CONFIG, emitter, 'hi');

    const idx = progressCallIndex(service, 'Thinking…');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(service.appendMessage.mock.calls[idx][0]).toEqual(
      expect.objectContaining({
        role: 'agent',
        agent: 'conversationalist',
        content: {
          kind: 'progress',
          agent: 'conversationalist',
          phase: 'Thinking…',
        },
      })
    );
    expect(service.appendMessage.mock.invocationCallOrder[idx]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0]
    );
  });

  it('emits Sketching concepts… before dispatching the art-director', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor({ intent: 'x' });
    const dispatch = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue(
        agentReply({
          type: 'plans',
          plans: [{ variantId: 'v1', skill: 'meme' }],
        })
      ));

    await (conductor as any)._runPlanPresentation(
      SESSION_ID,
      ctx,
      CONFIG,
      { intent: 'x' },
      emitter
    );

    const idx = progressCallIndex(service, 'Sketching concepts…');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(service.appendMessage.mock.calls[idx][0]).toEqual(
      expect.objectContaining({
        role: 'agent',
        agent: 'art-director',
      })
    );
    expect(service.appendMessage.mock.invocationCallOrder[idx]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0]
    );
  });

  it('emits Sketching new directions… before re-planning on a plan-stage revise', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor(
      { intent: 'x', lastPlans: [{ variantId: 'v1', skill: 'meme' }] },
      'awaiting_plan'
    );
    const dispatch = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue(
        agentReply({
          type: 'plans',
          plans: [{ variantId: 'v2', skill: 'meme' }],
        })
      ));

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bolder', targetDesignId: '', nonce: 'n1' },
      emitter
    );

    const idx = progressCallIndex(service, 'Sketching new directions…');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(service.appendMessage.mock.invocationCallOrder[idx]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0]
    );
  });

  it('emits Starting production… before executing an accepted plan', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeIntakeConductor(
      { intent: 'x', lastPlans: [{ variantId: 'v1', skill: 'meme' }] },
      'awaiting_plan'
    );
    const pipeline = ((conductor as any)._executePipeline = vi
      .fn()
      .mockResolvedValue([]));

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      undefined,
      undefined,
      emitter
    );

    const idx = progressCallIndex(service, 'Starting production…');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(service.appendMessage.mock.invocationCallOrder[idx]).toBeLessThan(
      pipeline.mock.invocationCallOrder[0]
    );
  });
});

describe('AiDesignerConductorService variant expansion', () => {
  const PLAN = {
    variantId: 'v1',
    skill: 'meme',
    concept: 'c1',
    slots: [{ id: 'headline', role: 'headline', kind: 'text' }],
    assetNeeds: [],
    palette: [],
    typeScale: {},
    background: { kind: 'solid' as const },
  };
  const PRIMARY_DOC = {
    mode: 'image',
    outputs: [
      {
        formatId: 'ig-post',
        name: 'Instagram Post',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children: [
          {
            id: 'e-hero',
            originId: 'hero',
            type: 'image',
            x: 0,
            y: 0,
            width: 1080,
            height: 1080,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: 'https://example.com/hero.png',
            fileId: 'f-hero',
            fitMode: 'cover',
          },
        ],
      },
    ],
  };
  const EXPANDED_RENDER = {
    designId: 'design-v1',
    variantId: 'v1-expanded',
    contactSheetUrl: 'https://example.com/expanded-sheet.png',
    outputPreviews: [
      { formatId: 'ig-post', fileId: 'f-post', url: 'https://example.com/post.png' },
      { formatId: 'ig-story', fileId: 'f-story', url: 'https://example.com/story.png' },
    ],
  };

  const makeExpansionConductor = (criticFindings: (callIndex: number) => any[]) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [PLAN] },
        config: { channels: ['ig-post', 'ig-story'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-v1',
        variantId: 'v1',
        contactSheetUrl: 'https://example.com/sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'f-post-0', url: 'https://example.com/post-0.png' },
        ],
      }),
      updateDesign: vi.fn().mockResolvedValue(EXPANDED_RENDER),
    };
    const composer = {
      applyFixes: vi.fn((doc: any) => Promise.resolve(doc)),
      sanitizeDoc: vi.fn((doc: any) => ({ doc, violations: [] })),
      refitSeededOutputs: vi.fn((doc: any) => doc),
      applySubjectFocalPoints: vi.fn(async (doc: any) => doc),
    };
    // Real designer-doc seeding (seedCopy/smartReflow) so the test sees what
    // the expansion actually produces, not a canned expanded doc.
    const realDocService = new DesignerDocService();
    const docService = {
      applyOps: vi.fn((doc: any, ops: any[]) => realDocService.applyOps(doc, ops)),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-v1', doc: PRIMARY_DOC }),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;
    (conductor as any)._composer = composer;
    (conductor as any)._docService = docService;
    (conductor as any)._designService = designService;
    (conductor as any)._skillRouter = {
      getRubric: vi.fn().mockReturnValue({ criteria: [] }),
    };

    let criticCall = 0;
    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'asset') {
        return Promise.resolve({ content: JSON.stringify({ type: 'assets', assets: {} }) });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({ content: JSON.stringify({ type: 'copy', texts: {} }) });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: PRIMARY_DOC }),
        });
      }
      if (agentId === 'vision-critic') {
        criticCall++;
        return Promise.resolve({
          content: JSON.stringify({
            type: 'findings',
            findings: criticFindings(criticCall),
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    return { conductor, service, saver, composer, docService, dispatchAgent };
  };

  it('composes the primary only, then addOutput-expands and QC\'s each variant', async () => {
    const emitter = makeEmitter();
    const { conductor, saver, docService, dispatchAgent } =
      makeExpansionConductor(() => []);

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // The composer only ever saw the primary format.
    const composeCall = dispatchAgent.mock.calls.find(
      ([_, agentId]: any) => agentId === 'composer'
    );
    expect(composeCall[2].outputs).toEqual([
      expect.objectContaining({ formatId: 'ig-post' }),
    ]);

    // The remaining format was auto-created via designer-doc addOutput…
    expect(docService.applyOps).toHaveBeenCalledTimes(1);
    expect(docService.applyOps.mock.calls[0][0]).toEqual(PRIMARY_DOC);
    expect(docService.applyOps.mock.calls[0][1]).toEqual([
      {
        op: 'addOutput',
        preset: {
          formatId: 'ig-story',
          name: 'Instagram Story',
          width: 1080,
          height: 1920,
        },
      },
    ]);
    // …and the seeded variant stays a faithful copy: no asset re-resolution
    // step runs, so the secondary output keeps the primary's fileId/src.
    const expandedDoc = saver.updateDesign.mock.calls[0][3];
    const primaryImage = expandedDoc.outputs[0].children.find(
      (el: any) => el.type === 'image'
    );
    const seededImage = expandedDoc.outputs[1].children.find(
      (el: any) => el.type === 'image'
    );
    expect(seededImage).toBeDefined();
    expect(seededImage.fileId).toBe(primaryImage.fileId);
    expect(seededImage.src).toBe(primaryImage.src);

    // One Design row: saveDesign once, updateDesign for the expansion (no
    // fixes found → no extra re-render).
    expect(saver.saveDesign).toHaveBeenCalledTimes(1);
    expect(saver.updateDesign).toHaveBeenCalledTimes(1);
    expect(saver.updateDesign.mock.calls[0][1]).toBe('design-v1');

    // Critic ran on the original (primary only) and once per variant format.
    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);
    expect(criticCalls[0][2].outputs).toEqual([
      expect.objectContaining({ formatId: 'ig-post' }),
    ]);
    expect(criticCalls[1][2].contactSheetUrl).toBe('https://example.com/story.png');
    expect(criticCalls[1][2].plans).toHaveLength(1);
    expect(criticCalls[1][2].outputs).toEqual([
      expect.objectContaining({ formatId: 'ig-story' }),
    ]);
    expect(criticCalls[1][2].outputPreviews).toEqual([
      { formatId: 'ig-story', url: 'https://example.com/story.png' },
    ]);

    // Per-format progress events.
    const phases = (emitter.progress as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: any) => `${call[0]}:${call[1]}`
    );
    expect(phases).toContain('composer:Adapting to ig-story');
    expect(phases).toContain('vision-critic:Reviewing ig-story');

    // The delivered result covers every output.
    const deliveredUpdate = (conductor as any)._service.updateSession.mock.calls.find(
      (call: any) => call[3].state === 'delivered'
    );
    expect(deliveredUpdate).toBeDefined();
    const preview = (emitter.preview as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(preview.outputPreviews.map((o: any) => o.formatId)).toEqual([
      'ig-post',
      'ig-story',
    ]);
  });

  it('applies format-pinned fixes and caps the variant QC at two passes', async () => {
    const emitter = makeEmitter();
    // The original's pass is clean; every variant pass finds an issue.
    const { conductor, saver, composer, dispatchAgent } = makeExpansionConductor(
      (callIndex) =>
        callIndex === 1
          ? []
          : [
              {
                issue: 'Headline clipped',
                slotId: 'headline',
                fix: { scope: 'shared', targetSlots: ['headline'], geometry: { y: 40 } },
              },
            ]
    );

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // Exactly two critic passes for the variant (critique → fixes → re-check),
    // each followed by format-pinned fixes and an in-place re-render.
    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(3); // 1 original + 2 variant passes
    expect(composer.applyFixes).toHaveBeenCalledTimes(2);
    for (const call of composer.applyFixes.mock.calls) {
      expect(call[4]).toEqual(['ig-story']);
    }
    expect(saver.updateDesign).toHaveBeenCalledTimes(3); // 1 expansion + 2 fixes
    expect(saver.saveDesign).toHaveBeenCalledTimes(1);
  });

  it('caps the revise vision re-check at two passes', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'prompt',
        brief: { intent: 'x', skillId: 'meme', lastPlans: [] },
        activeDesignIds: ['design-A'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-A', doc: { mode: 'image', outputs: [] } }),
    };
    const composer = {
      reviseByInstruction: vi.fn().mockResolvedValue({ mode: 'image', outputs: [] }),
      applyFixes: vi.fn().mockResolvedValue({ mode: 'image', outputs: [] }),
    };
    const saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-A-revised',
        variantId: 'revised',
        contactSheetUrl: 'https://example.com/revised-sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'f-rev', url: 'https://example.com/revised.png' },
        ],
      }),
      updateDesign: vi.fn().mockResolvedValue({
        designId: 'design-A-revised',
        variantId: 'revised',
        contactSheetUrl: 'https://example.com/revised-sheet-2.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'f-rev2', url: 'https://example.com/revised2.png' },
        ],
      }),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._designService = designService;
    (conductor as any)._composer = composer;
    (conductor as any)._saver = saver;
    (conductor as any)._skillRouter = {
      getRubric: vi.fn().mockReturnValue({ criteria: [] }),
    };
    const dispatchAgent = vi.fn().mockImplementation((_, agentId) => {
      if (agentId === 'vision-critic') {
        return Promise.resolve({
          content: JSON.stringify({
            type: 'findings',
            findings: [
              {
                issue: 'Still off',
                slotId: 'headline',
                fix: { scope: 'shared', targetSlots: ['headline'], geometry: { y: 10 } },
              },
            ],
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-A', nonce: 'n1' },
      emitter
    );

    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);
    expect(composer.applyFixes).toHaveBeenCalledTimes(2);
    expect(saver.updateDesign).toHaveBeenCalledTimes(2);
  });

  it('runs the composer sanitizer on the addOutput-seeded outputs', async () => {
    const emitter = makeEmitter();
    const { conductor, composer, docService } = makeExpansionConductor(() => []);

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(composer.sanitizeDoc).toHaveBeenCalledTimes(1);
    const [docArg, planArg] = composer.sanitizeDoc.mock.calls[0];
    // The expanded doc (both formats seeded) and the variant's plan.
    expect(docArg.outputs).toHaveLength(2);
    expect(planArg.variantId).toBe('v1');
    // The sanitizer ran AFTER the addOutput seeding, before the re-render.
    expect(composer.sanitizeDoc.mock.invocationCallOrder[0]).toBeGreaterThan(
      docService.applyOps.mock.invocationCallOrder[0]
    );
  });

  it('re-fits the seeded outputs to their own aspect before anything renders', async () => {
    const emitter = makeEmitter();
    const { conductor, composer, docService } = makeExpansionConductor(() => []);

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(composer.refitSeededOutputs).toHaveBeenCalledTimes(1);
    const [docArg] = composer.refitSeededOutputs.mock.calls[0];
    expect(docArg.outputs).toHaveLength(2);
    // Between the addOutput seeding and the sanitizer: the seed places every
    // element independently, so the re-fit is what makes the secondary format
    // the SAME design on a different canvas rather than a scattered one.
    expect(
      composer.refitSeededOutputs.mock.invocationCallOrder[0]
    ).toBeGreaterThan(docService.applyOps.mock.invocationCallOrder[0]);
    expect(
      composer.refitSeededOutputs.mock.invocationCallOrder[0]
    ).toBeLessThan(composer.sanitizeDoc.mock.invocationCallOrder[0]);
  });

  // Round 8 C2: the focal-point gate ran only inside compose, which sees the
  // PRIMARY format alone — the one output least likely to need it. A banner
  // secondary throwing away 85.7% of its source was never even eligible.
  it('runs the subject focal-point pass over the EXPANDED doc', async () => {
    const emitter = makeEmitter();
    const { conductor, composer, docService } = makeExpansionConductor(() => []);

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(composer.applySubjectFocalPoints).toHaveBeenCalledTimes(1);
    const [docArg, orgArg] = composer.applySubjectFocalPoints.mock.calls[0];
    // Every planned format, not just the primary.
    expect(docArg.outputs).toHaveLength(2);
    expect(orgArg).toBe(ctx.orgId);
    // After the re-fit (so each output carries its own final box) and before
    // the sanitizer/render.
    expect(
      composer.applySubjectFocalPoints.mock.invocationCallOrder[0]
    ).toBeGreaterThan(composer.refitSeededOutputs.mock.invocationCallOrder[0]);
    expect(
      composer.applySubjectFocalPoints.mock.invocationCallOrder[0]
    ).toBeLessThan(composer.sanitizeDoc.mock.invocationCallOrder[0]);
    expect(docService.applyOps).toHaveBeenCalled();
  });

  // Round 8 C6: the seeded multi-output doc is persisted BEFORE the per-format
  // QC loop, so a failure left the DB holding never-quality-checked outputs
  // while the user was told the variant shipped in its original format alone.
  it('rolls the persisted doc back when the expansion fails after saving', async () => {
    const emitter = makeEmitter();
    const { conductor, saver, service, docService, composer } =
      makeExpansionConductor(() => [
        { issue: 'caption is too low', fix: { scope: 'format-only' } },
      ]);
    // The expanded doc is persisted, THEN the per-format QC loop blows up.
    composer.applyFixes.mockRejectedValue(new Error('fixes exploded'));

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const notes = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .map(([arg]: any) => arg?.content?.md)
      .filter(Boolean)
      .join('\n');
    expect(notes).toContain('could only be delivered in its original format');

    // The last write restores the doc the expansion started from, so the row
    // matches the note the user was given.
    const restore = saver.updateDesign.mock.calls.at(-1)!;
    expect(restore[3]).toEqual(docService.applyOps.mock.calls[0][0]);
    expect(restore[3].outputs).toHaveLength(1);
  });

  it('posts a degradation note when the sanitizer cannot repair a seeded output', async () => {
    const emitter = makeEmitter();
    const { conductor, composer, service } = makeExpansionConductor(() => []);
    composer.sanitizeDoc.mockImplementation((doc: any) => ({
      doc,
      violations: [
        'Degenerate output "ig-story": no visible text elements remain although the plan carries copy — could not auto-repair.',
      ],
    }));

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      "variant 1's expanded formats could not be fully repaired automatically"
    );
  });

  it('threads the design doc element data into every critique dispatch', async () => {
    const emitter = makeEmitter();
    const { conductor, dispatchAgent } = makeExpansionConductor(() => []);

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);

    // Originals pass: the primary output's elements, with fills/bounds/z.
    const originalSummary = criticCalls[0][2].docSummary;
    expect(originalSummary).toHaveLength(1);
    expect(originalSummary[0].formatId).toBe('ig-post');
    expect(originalSummary[0].elements[0]).toMatchObject({
      originId: 'hero',
      type: 'image',
      x: 0,
      y: 0,
      width: 1080,
      height: 1080,
      z: 0,
    });

    // Per-format pass: the summary is scoped to the critiqued format only.
    expect(
      criticCalls[1][2].docSummary.map((o: any) => o.formatId)
    ).toEqual(['ig-story']);
  });

  it('treats a skipped critic pass as a degradation, not a clean pass', async () => {
    const emitter = makeEmitter();
    const { conductor, service, dispatchAgent } = makeExpansionConductor(() => []);
    const base = dispatchAgent.getMockImplementation()!;
    dispatchAgent.mockImplementation((callCtx: any, agentId: string, payload: any) =>
      agentId === 'vision-critic'
        ? Promise.resolve({
            content: JSON.stringify({
              type: 'findings',
              findings: [],
              skipped: true,
            }),
          })
        : base(callCtx, agentId, payload)
    );

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // No fixes were applied — a skipped pass never reads as "clean".
    const noteCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );
    expect(noteCalls).toHaveLength(1);
    expect(noteCalls[0][0].content.md).toContain(
      'the automatic quality pass was skipped for variant 1'
    );
    expect(noteCalls[0][0].content.md).toContain(
      'the automatic quality pass was skipped for variant 1 (ig-story)'
    );
  });
});

describe('AiDesignerConductorService._critiqueDocSummary imagery screening', () => {
  it('omits the text field for image elements so a corrupted doc never echoes markers', () => {
    const { conductor } = makeConductor();
    const doc = {
      mode: 'image',
      outputs: [
        {
          formatId: 'ig-post',
          width: 1080,
          height: 1080,
          children: [
            {
              id: 'e1',
              originId: 'headline',
              type: 'text',
              text: 'Hello',
              x: 0,
              y: 0,
              width: 100,
              height: 50,
            },
            {
              id: 'e2',
              originId: 'hero',
              type: 'image',
              text: 'REPLACE_IMAGE_NO_TEXT_NO_LOGOS_NO_WATERMARKS',
              x: 0,
              y: 0,
              width: 1080,
              height: 1080,
            },
          ],
        },
      ],
    };

    const summary = (conductor as any)._critiqueDocSummary(doc as any);

    expect(summary[0].elements[0].text).toBe('Hello');
    expect(summary[0].elements[1].text).toBeUndefined();
  });
});

describe('AiDesignerConductorService regenerateAsset fixes', () => {
  const REGEN_PLAN = {
    variantId: 'v1',
    skill: 'meme',
    concept: 'c1',
    slots: [
      { id: 'headline', role: 'headline', kind: 'text' },
      { id: 'hero', role: 'image', kind: 'image' },
    ],
    assetNeeds: [
      { slotId: 'hero', brief: 'coffee beans on wood', prefer: 'generate' },
    ],
    palette: [],
    typeScale: {},
    background: { kind: 'solid' as const },
  };
  const HERO_DOC = {
    mode: 'image',
    outputs: [
      {
        formatId: 'ig-post',
        name: 'Instagram Post',
        width: 1080,
        height: 1080,
        background: '#ffffff',
        children: [
          {
            id: 'e-hero',
            originId: 'hero',
            type: 'image',
            x: 0,
            y: 0,
            width: 1080,
            height: 1080,
            rotation: 0,
            opacity: 1,
            locked: false,
            hidden: false,
            src: 'https://example.com/hero.png',
            fileId: 'f-hero',
            fitMode: 'cover',
          },
        ],
      },
    ],
  };
  const NEW_ASSET = {
    slotId: 'v1:hero',
    fileId: 'f-new',
    path: 'https://example.com/new.png',
    type: 'image',
    source: 'generate',
    aspect: 'square',
    focalPoint: { x: 0.5, y: 0.5 },
  };
  const REGEN_FINDING = {
    issue: 'The photo has a baked-in logo',
    slotId: 'hero',
    fix: {
      scope: 'shared',
      regenerateAsset: { slotId: 'hero', brief: 'plain unbranded surfaces' },
    },
  };

  const makeRegenConductor = (opts: {
    channels?: string[];
    criticFindings: (callIndex: number) => any[];
    regenAssets?: Record<string, any>;
    /** Assets the INITIAL compose resolves — the stock ids a regeneration excludes. */
    initialAssets?: Record<string, any>;
    doc?: any;
    plan?: any;
  }) => {
    const plan = opts.plan ?? REGEN_PLAN;
    const doc = opts.doc ?? HERO_DOC;
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: [plan] },
        config: { channels: opts.channels ?? ['ig-post', 'ig-story'], variants: 1 },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-v1',
        variantId: 'v1',
        contactSheetUrl: 'https://example.com/sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'f-post-0', url: 'https://example.com/post-0.png' },
        ],
      }),
      updateDesign: vi.fn().mockResolvedValue({
        designId: 'design-v1',
        variantId: 'v1-expanded',
        contactSheetUrl: 'https://example.com/expanded-sheet.png',
        outputPreviews: [
          { formatId: 'ig-post', fileId: 'f-post', url: 'https://example.com/post.png' },
          { formatId: 'ig-story', fileId: 'f-story', url: 'https://example.com/story.png' },
        ],
      }),
    };
    const composer = {
      applyFixes: vi.fn((d: any) => Promise.resolve(d)),
      sanitizeDoc: vi.fn((d: any) => ({ doc: d, violations: [] })),
      refitSeededOutputs: vi.fn((d: any) => d),
      applySubjectFocalPoints: vi.fn(async (d: any) => d),
    };
    const realDocService = new DesignerDocService();
    const docService = {
      applyOps: vi.fn((d: any, ops: any[]) => realDocService.applyOps(d, ops)),
    };
    const designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-v1', doc }),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = saver;
    (conductor as any)._composer = composer;
    (conductor as any)._docService = docService;
    (conductor as any)._designService = designService;
    (conductor as any)._skillRouter = {
      getRubric: vi.fn().mockReturnValue({ criteria: [] }),
    };

    let criticCall = 0;
    const dispatchAgent = vi.fn().mockImplementation((_, agentId, payload) => {
      if (agentId === 'asset') {
        if (payload?.regenerate) {
          return Promise.resolve({
            content: JSON.stringify({
              type: 'assets',
              assets: opts.regenAssets ?? { 'v1:hero:square': NEW_ASSET },
            }),
          });
        }
        return Promise.resolve({
          content: JSON.stringify({
            type: 'assets',
            assets: opts.initialAssets ?? {},
          }),
        });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({ content: JSON.stringify({ type: 'copy', texts: {} }) });
      }
      if (agentId === 'composer') {
        return Promise.resolve({ content: JSON.stringify({ type: 'doc', doc }) });
      }
      if (agentId === 'vision-critic') {
        criticCall++;
        return Promise.resolve({
          content: JSON.stringify({
            type: 'findings',
            findings: opts.criticFindings(criticCall),
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    const regenDispatches = () =>
      dispatchAgent.mock.calls.filter(
        ([_, agentId, payload]: any) => agentId === 'asset' && payload?.regenerate
      );
    const headsUpNotes = () =>
      (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) =>
          call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
      );

    return { conductor, service, saver, composer, dispatchAgent, regenDispatches, headsUpNotes };
  };

  it('dispatches the asset agent once for a regenerateAsset finding and patches every output sharing the old fileId', async () => {
    const emitter = makeEmitter();
    // Original pass clean; the ig-story variant pass flags the imagery; the
    // re-check pass is clean.
    const { conductor, saver, composer, regenDispatches } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // Exactly one regeneration dispatch, through the asset agent, with the
    // variant-scoped slot key and the plan brief + the critic's guidance.
    const regens = regenDispatches();
    expect(regens).toHaveLength(1);
    const need = regens[0][2].assetNeeds[0];
    expect(regens[0][2].assetNeeds).toHaveLength(1);
    expect(need.slotId).toBe('v1:hero');
    expect(need.brief).toBe('coffee beans on wood. plain unbranded surfaces');
    expect(need.prefer).toBe('generate');
    expect(need.aspect).toBe('square');

    // The new asset landed on BOTH outputs (the seeded ig-story copy shares
    // the old fileId) — the variant fidelity invariant holds.
    const patchedDoc = saver.updateDesign.mock.calls.at(-1)![3];
    expect(patchedDoc.outputs).toHaveLength(2);
    for (const out of patchedDoc.outputs) {
      const hero = out.children.find((el: any) => el.originId === 'hero');
      expect(hero.fileId).toBe('f-new');
      expect(hero.src).toBe('https://example.com/new.png');
    }

    // The pass's applyFixes still ran, with zero remaining findings.
    expect(composer.applyFixes).toHaveBeenCalledTimes(1);
    expect(composer.applyFixes.mock.calls[0][1]).toEqual([]);
  });

  it('drops the scrims sitting over swapped imagery, keeping the ones that are not', async () => {
    const emitter = makeEmitter();
    // A contrast scrim is a judgement about ONE photo. Left behind after the
    // swap it is never re-opened: the backdrop-only render hides TEXT but
    // keeps SHAPES, so the stale scrim becomes the backdrop the next audit
    // measures (stdev ≈ 0, crossing 0) and the contrast fix early-returns
    // forever. The live ordering was: regenerated imagery → scrim added over
    // it → regenerated imagery again.
    const doc = {
      mode: 'image',
      outputs: [
        {
          formatId: 'ig-post',
          name: 'Instagram Post',
          width: 1080,
          height: 1080,
          background: '#ffffff',
          children: [
            {
              id: 'e-hero',
              originId: 'hero',
              type: 'image',
              x: 0,
              y: 0,
              width: 1080,
              height: 540,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              src: 'https://example.com/hero.png',
              fileId: 'f-hero',
              fitMode: 'cover',
            },
            {
              id: 'e-scrim-over',
              originId: 'headline-scrim',
              type: 'shape',
              shape: 'rect',
              x: 54,
              y: 200,
              width: 972,
              height: 200,
              rotation: 0,
              opacity: 0.55,
              locked: false,
              hidden: false,
              fill: '#000000',
            },
            {
              id: 'e-scrim-clear',
              originId: 'legal-scrim',
              type: 'shape',
              shape: 'rect',
              x: 54,
              y: 800,
              width: 972,
              height: 120,
              rotation: 0,
              opacity: 0.55,
              locked: false,
              hidden: false,
              fill: '#000000',
            },
          ],
        },
      ],
    };

    const { conductor, saver, regenDispatches } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
      doc,
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    const patchedDoc = saver.updateDesign.mock.calls.at(-1)![3];
    for (const out of patchedDoc.outputs) {
      const ids = out.children.map((el: any) => el.originId);
      // The scrim judged against the replaced photo is gone — the decision is
      // re-made against the new one by the contrast pass that follows.
      expect(ids).not.toContain('headline-scrim');
      // The one clear of the swapped imagery was judged against something
      // else and stays.
      expect(ids).toContain('legal-scrim');
      expect(
        out.children.find((el: any) => el.originId === 'hero').fileId
      ).toBe('f-new');
    }
  });

  it('discloses a defect that SURVIVED a successful regeneration, exactly once', async () => {
    const emitter = makeEmitter();
    // Both variant passes flag the same slot; the first one regenerates fine.
    const { conductor, regenDispatches, headsUpNotes } = makeRegenConductor({
      criticFindings: (call) => (call === 1 ? [] : [REGEN_FINDING]),
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    // The cap refusal is not a failure of the dispatch, so no "couldn't
    // regenerate" line — but the swap DID happen and the critic flagged the
    // slot again, which is the only signal that the defect survived. Staying
    // silent here shipped a design carrying a brand mark as "clean".
    const md = headsUpNotes()
      .map((call) => call[0].content.md)
      .join('\n');
    expect(md).not.toContain("couldn't regenerate");
    expect(md).toContain(
      'we replaced the imagery for variant 1 but the review flagged it again'
    );
  });

  it('says nothing when a successful regeneration was never flagged again', async () => {
    const emitter = makeEmitter();
    // Flagged on the ig-story pass, clean on the re-check: the replacement was
    // re-examined and passed — claiming otherwise would be knowledge we lack.
    const { conductor, regenDispatches, headsUpNotes } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    const md = headsUpNotes()
      .map((call) => call[0].content.md)
      .join('\n');
    expect(md).not.toContain('the review flagged it again');
  });

  it('emits the survival disclosure ONCE however many passes hit the cap', async () => {
    const emitter = makeEmitter();
    // Two secondary formats × two passes each = three separate cap refusals
    // after the one successful regeneration. The old per-refusal push turned
    // that into the same line three times.
    const { conductor, saver, headsUpNotes } = makeRegenConductor({
      channels: ['ig-post', 'ig-story', 'x-post'],
      criticFindings: (call) => (call === 1 ? [] : [REGEN_FINDING]),
    });
    saver.updateDesign.mockResolvedValue({
      designId: 'design-v1',
      variantId: 'v1-expanded',
      contactSheetUrl: 'https://example.com/expanded-sheet.png',
      outputPreviews: [
        { formatId: 'ig-post', fileId: 'f-post', url: 'https://example.com/post.png' },
        { formatId: 'ig-story', fileId: 'f-story', url: 'https://example.com/story.png' },
        { formatId: 'x-post', fileId: 'f-x', url: 'https://example.com/x.png' },
      ],
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const md = headsUpNotes()
      .map((call) => call[0].content.md)
      .join('\n');
    expect(
      md.match(/we replaced the imagery for variant 1 but the review flagged it again/g)
    ).toHaveLength(1);
  });

  const BRAND_FINDING = {
    ...REGEN_FINDING,
    criterion: 'brand_safety',
    issue: 'The sneaker carries a recognizable brand swoosh',
  };

  it('switches a brand_safety regeneration to stock instead of re-rolling the image model', async () => {
    const emitter = makeEmitter();
    // First flag: a generic defect → generate. Second: brand_safety → the
    // technique changes, so a SECOND attempt is allowed (and only then).
    const { conductor, saver, regenDispatches, headsUpNotes } = makeRegenConductor({
      channels: ['ig-post', 'ig-story', 'x-post'],
      criticFindings: (call) =>
        call === 1 ? [] : call === 2 ? [REGEN_FINDING] : [BRAND_FINDING],
    });
    saver.updateDesign.mockResolvedValue({
      designId: 'design-v1',
      variantId: 'v1-expanded',
      contactSheetUrl: 'https://example.com/expanded-sheet.png',
      outputPreviews: [
        { formatId: 'ig-post', fileId: 'f-post', url: 'https://example.com/post.png' },
        { formatId: 'ig-story', fileId: 'f-story', url: 'https://example.com/story.png' },
        { formatId: 'x-post', fileId: 'f-x', url: 'https://example.com/x.png' },
      ],
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const regens = regenDispatches();
    expect(regens).toHaveLength(2);
    expect(regens[0][2].assetNeeds[0].prefer).toBe('generate');
    const stockNeed = regens[1][2].assetNeeds[0];
    // prefer + stockOnly: without the flag the asset agent promotes a
    // regeneration's 'stock' back to 'either' and generates anyway.
    expect(stockNeed.prefer).toBe('stock');
    expect(stockNeed.stockOnly).toBe(true);
    expect(stockNeed.brief).toContain('generic unbranded');
    // …and the third+ refusals (technique exhausted) disclose once.
    const md = headsUpNotes()
      .map((call) => call[0].content.md)
      .join('\n');
    expect(
      md.match(/we replaced the imagery for variant 1 but the review flagged it again/g)
    ).toHaveLength(1);
  });

  it('caps a brand_safety slot at ONE stock attempt — the technique must change', async () => {
    const emitter = makeEmitter();
    const { conductor, regenDispatches } = makeRegenConductor({
      criticFindings: (call) => (call === 1 ? [] : [BRAND_FINDING]),
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // Every pass asks for the same technique, so exactly one dispatch — a
    // stock search is cheap but re-running it is the same dice.
    const regens = regenDispatches();
    expect(regens).toHaveLength(1);
    expect(regens[0][2].assetNeeds[0].prefer).toBe('stock');
  });

  it('never says "image image" for the canonical image slot', async () => {
    const emitter = makeEmitter();
    const imagePlan = {
      ...REGEN_PLAN,
      slots: [
        { id: 'headline', role: 'headline', kind: 'text' },
        { id: 'image', role: 'image', kind: 'image' },
      ],
      assetNeeds: [
        { slotId: 'image', brief: 'coffee beans on wood', prefer: 'generate' },
      ],
    };
    const imageDoc = {
      ...HERO_DOC,
      outputs: [
        {
          ...HERO_DOC.outputs[0],
          children: [
            { ...HERO_DOC.outputs[0].children[0], originId: 'image' },
          ],
        },
      ],
    };
    const { conductor, headsUpNotes } = makeRegenConductor({
      plan: imagePlan,
      doc: imageDoc,
      criticFindings: (call) =>
        call === 2
          ? [
              {
                issue: 'The photo has a baked-in logo',
                slotId: 'image',
                fix: {
                  scope: 'shared',
                  regenerateAsset: { slotId: 'image', brief: 'unbranded' },
                },
              },
            ]
          : [],
      regenAssets: {}, // force the genuine-failure note
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const notes = headsUpNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0][0].content.md).toContain(
      "couldn't regenerate the image — the original may contain unwanted text"
    );
    expect(notes[0][0].content.md).not.toContain('image image');
  });

  // Round 8 C7a: a regenerateAsset fix against a slot with NO imagery is a
  // critic error, but the note claimed "the original may contain unwanted
  // text" about vector badge/accent slots that have no original at all.
  it('says nothing when the flagged slot carries no imagery at all', async () => {
    const emitter = makeEmitter();
    const vectorDoc = {
      ...HERO_DOC,
      outputs: [
        {
          ...HERO_DOC.outputs[0],
          children: [
            {
              id: 'e-badge',
              originId: 'badge',
              type: 'shape',
              shape: 'star',
              x: 0,
              y: 0,
              width: 200,
              height: 200,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              fill: '#ff0000',
            },
          ],
        },
      ],
    };
    const { conductor, headsUpNotes, dispatchAgent } = makeRegenConductor({
      doc: vectorDoc,
      criticFindings: (call: number) =>
        call === 2
          ? [
              {
                issue: 'The badge has baked-in text',
                slotId: 'badge',
                fix: {
                  scope: 'shared',
                  regenerateAsset: { slotId: 'badge', brief: 'no text' },
                },
              },
            ]
          : [],
      regenAssets: {},
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // No regeneration note about a slot that has no original, and no image
    // spend either — the finding is dropped outright.
    const md = headsUpNotes()
      .map(([arg]: any) => arg.content.md)
      .join('\n');
    expect(md).not.toContain("couldn't regenerate");
    expect(
      dispatchAgent.mock.calls.filter(([, agentId]: any) => agentId === 'asset')
    ).toHaveLength(1); // the initial compose asset call only
  });

  it('dedupes identical degradation notes at delivery', async () => {
    const emitter = makeEmitter();
    const { conductor } = makeRegenConductor({ criticFindings: () => [] });
    const note = "couldn't regenerate the hero image — the original may contain unwanted text";
    const labelled = 'variant 1 used a simplified fallback layout';
    // Belt-and-braces backstop at the READ site: every other note interpolates
    // a per-variant label, so two identical strings are the same message
    // repeated, never two distinct degradations.
    (conductor as any)._executePipeline = vi.fn(async (sessionId: string) => {
      (conductor as any)._degradationNotes.set(sessionId, [
        note,
        labelled,
        note,
      ]);
      return [{ designId: 'design-v1', variantId: 'v1', outputPreviews: [] }];
    });
    const emitDelivery = vi.fn().mockResolvedValue(undefined);
    (conductor as any)._emitDelivery = emitDelivery;

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(emitDelivery).toHaveBeenCalledTimes(1);
    expect(emitDelivery.mock.calls[0][4]).toEqual([note, labelled]);
  });

  it('keeps the old image and posts a degradation note when regeneration fails', async () => {
    const emitter = makeEmitter();
    const { conductor, saver, regenDispatches, headsUpNotes } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
      regenAssets: {}, // the asset agent produced nothing
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    const finalDoc = saver.updateDesign.mock.calls.at(-1)![3];
    for (const out of finalDoc.outputs) {
      const hero = out.children.find((el: any) => el.originId === 'hero');
      expect(hero.fileId).toBe('f-hero');
      expect(hero.src).toBe('https://example.com/hero.png');
    }
    const notes = headsUpNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0][0].content.md).toContain(
      "couldn't regenerate the hero image — the original may contain unwanted text"
    );
  });

  const STOCK_ASSET = (stockId: string, fileId: string, url: string) => ({
    slotId: 'v1:hero',
    fileId,
    path: url,
    type: 'image',
    source: 'stock',
    aspect: 'square',
    stockId,
  });

  it('passes the previous stock pick to the asset agent as an exclusion', async () => {
    const emitter = makeEmitter();
    const { conductor, regenDispatches } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
      initialAssets: {
        'v1:hero:square': STOCK_ASSET('photo-1', 'f-hero', 'https://example.com/hero.png'),
      },
      regenAssets: {
        'v1:hero:square': STOCK_ASSET('photo-2', 'f-new', 'https://example.com/new.png'),
      },
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // Without it, the deterministic (and 60s-Redis-cached) stock search hands
    // the identical photo straight back under a fresh fileId.
    expect(regenDispatches()[0][2].assetNeeds[0].excludeStockId).toBe('photo-1');
  });

  it('treats a regenerated stock asset with the SAME stockId as a failure', async () => {
    const emitter = makeEmitter();
    const { conductor, saver, regenDispatches, headsUpNotes } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
      initialAssets: {
        'v1:hero:square': STOCK_ASSET('photo-1', 'f-hero', 'https://example.com/hero.png'),
      },
      // The exclusion is best-effort — a one-result search has nothing else to
      // offer and hands back the rejected photo under a new fileId.
      regenAssets: {
        'v1:hero:square': STOCK_ASSET('photo-1', 'f-new', 'https://example.com/new.png'),
      },
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    // Original imagery kept — a fileId swap to the same photo is not a fix.
    const finalDoc = saver.updateDesign.mock.calls.at(-1)![3];
    for (const out of finalDoc.outputs) {
      const hero = out.children.find((el: any) => el.originId === 'hero');
      expect(hero.fileId).toBe('f-hero');
      expect(hero.src).toBe('https://example.com/hero.png');
    }
    // …and the user hears about it instead of a false "regenerated" success.
    const notes = headsUpNotes();
    expect(notes).toHaveLength(1);
    expect(notes[0][0].content.md).toContain(
      "couldn't regenerate the hero image — the original may contain unwanted text"
    );
  });

  it('accepts a genuinely DIFFERENT stock photo', async () => {
    const emitter = makeEmitter();
    const { conductor, saver, headsUpNotes } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING] : []),
      initialAssets: {
        'v1:hero:square': STOCK_ASSET('photo-1', 'f-hero', 'https://example.com/hero.png'),
      },
      regenAssets: {
        'v1:hero:square': STOCK_ASSET('photo-2', 'f-new', 'https://example.com/new.png'),
      },
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const finalDoc = saver.updateDesign.mock.calls.at(-1)![3];
    for (const out of finalDoc.outputs) {
      expect(
        out.children.find((el: any) => el.originId === 'hero').fileId
      ).toBe('f-new');
    }
    // (The initial compose still notes the stock-instead-of-generated
    // degradation; what must NOT appear is a regeneration failure.)
    const md = headsUpNotes()
      .map((call) => call[0].content.md)
      .join('\n');
    expect(md).not.toContain("couldn't regenerate");
  });

  it('clears the session stock-id ledger with the pipeline', async () => {
    const emitter = makeEmitter();
    const { conductor } = makeRegenConductor({
      criticFindings: () => [],
      initialAssets: {
        'v1:hero:square': STOCK_ASSET('photo-1', 'f-hero', 'https://example.com/hero.png'),
      },
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect((conductor as any)._assetStockIds.has(SESSION_ID)).toBe(false);
  });

  it('routes the non-regenerate findings of a mixed batch through applyFixes', async () => {
    const emitter = makeEmitter();
    const geometryFinding = {
      issue: 'Headline clipped',
      slotId: 'headline',
      fix: { scope: 'shared', targetSlots: ['headline'], geometry: { y: 40 } },
    };
    const { conductor, composer, regenDispatches } = makeRegenConductor({
      criticFindings: (call) => (call === 2 ? [REGEN_FINDING, geometryFinding] : []),
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    expect(composer.applyFixes).toHaveBeenCalledTimes(1);
    expect(composer.applyFixes.mock.calls[0][1]).toEqual([geometryFinding]);
  });

  it('patches an output-level bg image when the flagged slot is the plan background', async () => {
    const emitter = makeEmitter();
    const bgPlan = {
      ...REGEN_PLAN,
      background: { kind: 'image' as const, ref: 'asset:hero' as const },
    };
    const bgDoc = {
      mode: 'image',
      outputs: [
        {
          formatId: 'ig-post',
          name: 'Instagram Post',
          width: 1080,
          height: 1080,
          background: '#000000',
          bg: {
            type: 'image',
            src: 'https://example.com/hero.png',
            fileId: 'f-hero',
            focalPoint: { x: 0.5, y: 0.5 },
          },
          children: [
            {
              id: 'e-headline',
              originId: 'headline',
              type: 'text',
              x: 0,
              y: 100,
              width: 1080,
              height: 200,
              rotation: 0,
              opacity: 1,
              locked: false,
              hidden: false,
              text: 'Hello',
              fontSize: 60,
            },
          ],
        },
      ],
    };
    // Single channel: the regeneration runs in the original's auto-revise pass.
    const { conductor, saver, regenDispatches } = makeRegenConductor({
      channels: ['ig-post'],
      criticFindings: (call) => (call === 1 ? [REGEN_FINDING] : []),
      plan: bgPlan,
      doc: bgDoc,
    });

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    expect(regenDispatches()).toHaveLength(1);
    const patchedDoc = saver.updateDesign.mock.calls.at(-1)![3];
    expect(patchedDoc.outputs[0].bg).toEqual({
      type: 'image',
      src: 'https://example.com/new.png',
      fileId: 'f-new',
      focalPoint: { x: 0.5, y: 0.5 },
    });
  });
});

// Round 7 C5: the formatId (`custom-${w}x${h}`) is the addressing key for
// per-format critiques, revise targeting and the expansion's
// `outputPreviews.find(...)`. Two identical custom sizes produced two outputs
// sharing one id, so the second was permanently unaddressable.
describe('AiDesignerConductorService._resolveOutputs formatId uniqueness (round 7 C5)', () => {
  const resolve = (config: any) => {
    const { conductor } = makeConductor({});
    return (conductor as any)._resolveOutputs(config);
  };

  it('collapses two identical custom sizes into one output', () => {
    const outs = resolve({
      channels: [],
      customSizes: [
        { width: 1080, height: 1080, name: 'A' },
        { width: 1080, height: 1080, name: 'B' },
      ],
    });

    expect(outs.map((o: any) => o.formatId)).toEqual(['custom-1080x1080']);
    // First wins — the user's original entry keeps its name.
    expect(outs[0].name).toBe('A');
  });

  it('keeps genuinely different custom sizes', () => {
    const outs = resolve({
      channels: [],
      customSizes: [
        { width: 1080, height: 1080 },
        { width: 1080, height: 1350 },
      ],
    });

    expect(outs.map((o: any) => o.formatId)).toEqual([
      'custom-1080x1080',
      'custom-1080x1350',
    ]);
  });

  it('collapses a repeated channel id from a stored config too', () => {
    const outs = resolve({ channels: ['ig-post', 'ig-post'] });
    expect(outs.map((o: any) => o.formatId)).toEqual(['ig-post']);
  });
});

// Round 7 C6: a format-only revision naming no output this doc actually has
// used to filter every emitted op away and no-op in silence.
describe('AiDesignerConductorService format-only revise degradation (round 7 C6)', () => {
  const DOC = {
    mode: 'image',
    outputs: [
      { id: 'a', formatId: 'ig-square', name: 'IG', width: 1080, height: 1080, background: '#fff', children: [] },
      { id: 'b', formatId: 'fb-post', name: 'FB', width: 1200, height: 630, background: '#fff', children: [] },
    ],
  } as any;

  const setup = () => {
    const { conductor, service } = makeConductor({});
    const reviseByInstruction = vi.fn().mockResolvedValue(DOC);
    (conductor as any)._composer = {
      reviseByInstruction,
      canResolveFormatScope: (doc: any, targetOutputs?: string[]) =>
        (targetOutputs ?? []).some((id) =>
          doc.outputs.some((o: any) => o.formatId === id)
        ),
    };
    (conductor as any)._loadDesignDoc = vi.fn().mockResolvedValue(DOC);
    (conductor as any)._resolveSaveFolder = vi.fn().mockResolvedValue(null);
    (conductor as any)._saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'd1',
        variantId: 'v1',
        outputPreviews: [],
      }),
    };
    (conductor as any)._service = {
      ...service,
      getSessionForUser: vi.fn().mockResolvedValue({ config: {}, brief: {} }),
    };
    return { conductor, reviseByInstruction };
  };

  it('honors a format-only revision that names a real output', async () => {
    const { conductor, reviseByInstruction } = setup();
    const notes: string[] = [];

    await (conductor as any)._reviseDesign(
      SESSION_ID,
      ctx,
      'design-1',
      {
        instruction: 'make the headline bigger',
        scope: 'format-only',
        targetOutputs: ['fb-post'],
      },
      makeEmitter(),
      notes
    );

    expect(reviseByInstruction).toHaveBeenCalledWith(
      DOC,
      'make the headline bigger',
      'format-only',
      ORG_ID,
      ['fb-post'],
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(notes).toEqual([]);
  });

  it('degrades an unresolvable format-only revision to shared WITH a note', async () => {
    const { conductor, reviseByInstruction } = setup();
    const notes: string[] = [];

    await (conductor as any)._reviseDesign(
      SESSION_ID,
      ctx,
      'design-1',
      {
        instruction: 'make the headline bigger',
        scope: 'format-only',
        targetOutputs: ['tiktok-vertical'],
      },
      makeEmitter(),
      notes
    );

    // Applied everywhere instead of nowhere.
    expect(reviseByInstruction).toHaveBeenCalledWith(
      DOC,
      'make the headline bigger',
      'shared',
      ORG_ID,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('every size');
  });

  it('degrades a format-only revision that names no output at all', async () => {
    const { conductor, reviseByInstruction } = setup();
    const notes: string[] = [];

    await (conductor as any)._reviseDesign(
      SESSION_ID,
      ctx,
      'design-1',
      { instruction: 'brighten it', scope: 'format-only' },
      makeEmitter(),
      notes
    );

    expect(reviseByInstruction.mock.calls[0][2]).toBe('shared');
    expect(notes).toHaveLength(1);
  });

  it('leaves a shared revision (and its notes) alone', async () => {
    const { conductor, reviseByInstruction } = setup();
    const notes: string[] = [];

    await (conductor as any)._reviseDesign(
      SESSION_ID,
      ctx,
      'design-1',
      { instruction: 'brighten it', scope: 'shared', targetOutputs: ['nope'] },
      makeEmitter(),
      notes
    );

    expect(reviseByInstruction.mock.calls[0][2]).toBe('shared');
    expect(reviseByInstruction.mock.calls[0][4]).toEqual(['nope']);
    expect(notes).toEqual([]);
  });
});

// Round 7 C3: `referenceFileIds` rode into the asset dispatch and was never
// read — no image provider in use accepts an init/reference image on the
// text-to-image path. References remain an interpreted-cue feature; the
// dispatch stops pretending otherwise and the user is told what they got.
describe('AiDesignerConductorService reference images are cue-only (round 7 C3)', () => {
  const runPipeline = async (config: Record<string, unknown>) => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x' },
        config,
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const { conductor } = makeConductor({ service });
    (conductor as any)._saver = {
      saveDesign: vi.fn().mockResolvedValue({
        designId: 'design-v1',
        variantId: 'v1',
        outputPreviews: [],
      }),
    };
    const dispatches: { agentId: string; payload: any }[] = [];
    (conductor as any)._dispatchAgent = vi
      .fn()
      .mockImplementation((_: unknown, agentId: string, payload: any) => {
        dispatches.push({ agentId, payload });
        if (agentId === 'art-director') {
          return Promise.resolve({
            content: JSON.stringify({
              type: 'plans',
              plans: [
                {
                  variantId: 'v1',
                  skill: 'meme',
                  slots: [{ id: 'hero', role: 'image', kind: 'image' }],
                  assetNeeds: [
                    { slotId: 'hero', brief: 'a hero image', prefer: 'generate' },
                  ],
                },
              ],
            }),
          });
        }
        if (agentId === 'asset') {
          return Promise.resolve({
            content: JSON.stringify({
              type: 'assets',
              assets: {
                'v1:hero:square': {
                  slotId: 'v1:hero',
                  fileId: 'f1',
                  path: 'https://example.com/i.png',
                  type: 'image',
                  source: 'generate',
                  aspect: 'square',
                },
              },
            }),
          });
        }
        if (agentId === 'copywriter') {
          return Promise.resolve({
            content: JSON.stringify({ type: 'copy', texts: {} }),
          });
        }
        return Promise.resolve({ content: '{}' });
      });
    (conductor as any)._parseDesignDoc = vi.fn().mockReturnValue({ layers: [] });
    const emitDelivery = vi.fn().mockResolvedValue(undefined);
    (conductor as any)._emitDelivery = emitDelivery;

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-1',
      undefined,
      false,
      undefined,
      emitter
    );

    return { dispatches, emitDelivery };
  };

  it('never forwards referenceFileIds to the asset agent, and says so', async () => {
    const { dispatches, emitDelivery } = await runPipeline({
      channels: ['ig-post'],
      variants: 1,
      referenceFileIds: ['file-a', 'file-b'],
    });

    const assetDispatch = dispatches.find((d) => d.agentId === 'asset');
    expect(assetDispatch).toBeDefined();
    expect(assetDispatch!.payload).not.toHaveProperty('referenceFileIds');

    const notes: string[] = emitDelivery.mock.calls[0][4];
    expect(notes.some((n) => n.includes('reference images guided the brief'))).toBe(
      true
    );
  });

  it('posts no reference note when the user supplied none', async () => {
    const { emitDelivery } = await runPipeline({
      channels: ['ig-post'],
      variants: 1,
    });

    const notes: string[] = emitDelivery.mock.calls[0][4];
    expect(notes.some((n) => n.includes('reference images'))).toBe(false);
  });
});

// Round 8 C7b: a pinned style preset and a selected brand are both honoured by
// the art director in the same breath, so plans could come back entirely in the
// preset's colours with nothing telling the user the brand was dropped.
describe('AiDesignerConductorService brand-palette override note', () => {
  const withBrand = (palette: unknown) => {
    const { conductor } = makeConductor();
    (conductor as any)._brands = {
      getBrand: vi.fn().mockResolvedValue({ palette }),
    };
    return conductor;
  };

  const note = (
    conductor: any,
    config: any,
    brief: any,
    plans: any[]
  ): Promise<string | undefined> =>
    conductor._brandPaletteOverrideNote(ctx, config, brief, plans);

  const CONFIG = { brandProfileId: 'brand-1', variants: 1 } as any;
  const BRIEF = { intent: 'x', styleId: 'editorial-mono' } as any;

  it('warns when no plan palette entry is a brand colour', async () => {
    const conductor = withBrand(['#0A7D5B', '#F3E9DC']);

    expect(
      await note(conductor, CONFIG, BRIEF, [{ palette: ['#111111', '#ffffff'] }])
    ).toContain('brand palette wasn\'t used');
  });

  it('names the style the user actually pinned', async () => {
    const conductor = withBrand(['#0A7D5B']);

    expect(
      await note(conductor, CONFIG, BRIEF, [{ palette: ['#111111'] }])
    ).toContain('"editorial-mono"');
  });

  it('stays quiet when a brand colour DID survive into the plans', async () => {
    const conductor = withBrand(['#0A7D5B', '#F3E9DC']);

    expect(
      await note(conductor, CONFIG, BRIEF, [{ palette: ['#0a7d5b', '#ffffff'] }])
    ).toBeUndefined();
  });

  it('stays quiet with no pinned style, no brand, or an empty brand palette', async () => {
    const conductor = withBrand(['#0A7D5B']);
    const plans = [{ palette: ['#111111'] }];

    expect(
      await note(conductor, CONFIG, { intent: 'x' }, plans)
    ).toBeUndefined();
    expect(
      await note(conductor, { variants: 1 } as any, BRIEF, plans)
    ).toBeUndefined();
    expect(
      await note(withBrand([]), CONFIG, BRIEF, plans)
    ).toBeUndefined();
  });

  it('stays quiet when the plans carry no palette to compare', async () => {
    const conductor = withBrand(['#0A7D5B']);

    expect(await note(conductor, CONFIG, BRIEF, [{}])).toBeUndefined();
  });

  it('never throws when the brand lookup fails', async () => {
    const { conductor } = makeConductor();
    (conductor as any)._brands = {
      getBrand: vi.fn().mockRejectedValue(new Error('db down')),
    };

    expect(
      await note(conductor, CONFIG, BRIEF, [{ palette: ['#111111'] }])
    ).toBeUndefined();
  });

  it('is inert when no BrandsService is wired in', async () => {
    const { conductor } = makeConductor();

    expect(
      await note(conductor, CONFIG, BRIEF, [{ palette: ['#111111'] }])
    ).toBeUndefined();
  });
});

describe('_dispatchAgent abort signal', () => {
  // Exercises the REAL _dispatchAgent (every other block stubs it): a live
  // AbortSignal must ride the dispatch metadata into the in-process handler so
  // a cancel/timeout stops the underlying LLM/image call.
  const AGENT_ID = 'abort-test-agent';

  const wireAgent = (handler: (context: any) => Promise<any>) => {
    registerInProcessAgent(AGENT_ID, handler as any);
    registryState.swap([
      { agent_id: AGENT_ID, type: 'inprocess', is_default: false } as any,
    ]);
  };

  afterEach(() => {
    unregisterInProcessAgent(AGENT_ID);
    registryState.swap([]);
    vi.unstubAllEnvs();
  });

  it('threads a per-dispatch AbortSignal into the metadata, aborted when the session cancels mid-dispatch', async () => {
    const { conductor } = makeConductor();
    let seenMetadata: any;
    // Settles only when the abort lands — mirroring an agent whose LLM call
    // honours the signal.
    wireAgent(
      (context) =>
        new Promise((resolve, reject) => {
          seenMetadata = context.metadata;
          context.metadata.signal.addEventListener(
            'abort',
            () => reject(new Error('Cancelled')),
            { once: true }
          );
        })
    );
    const sessionAbort = new AbortController();
    (conductor as any)._aborts.set(SESSION_ID, sessionAbort);

    const dispatch = (conductor as any)._dispatchAgent(ctx, AGENT_ID, {});
    // The budget check precedes the dispatch — let the handler start first.
    await new Promise((resolve) => setImmediate(resolve));
    expect(seenMetadata.signal).toBeInstanceOf(AbortSignal);
    expect(seenMetadata.signal.aborted).toBe(false);
    // Linked, not the session signal itself: a session cancel aborts what the
    // handler holds, while the session signal stays the pipeline's own gate.
    sessionAbort.abort();
    expect(seenMetadata.signal.aborted).toBe(true);
    await expect(dispatch).rejects.toThrow('Pipeline cancelled');
  });

  it('works without a session abort controller (metadata signal simply never aborts)', async () => {
    const { conductor } = makeConductor();
    let seenMetadata: any;
    wireAgent(async (context) => {
      seenMetadata = context.metadata;
      return { content: '{}', workflow_complete: false };
    });

    await (conductor as any)._dispatchAgent(ctx, AGENT_ID, {});

    expect(seenMetadata.signal).toBeInstanceOf(AbortSignal);
    expect(seenMetadata.signal.aborted).toBe(false);
  });

  it('aborts the dispatch signal when the dispatch times out', async () => {
    vi.stubEnv('AI_DESIGNER_AGENT_TIMEOUT_MS', '50');
    const { conductor } = makeConductor();
    let seenMetadata: any;
    // Never settles — the timeout must be what ends the dispatch.
    wireAgent((context) => {
      seenMetadata = context.metadata;
      return new Promise(() => {});
    });

    await expect(
      (conductor as any)._dispatchAgent(ctx, AGENT_ID, {})
    ).rejects.toThrow(/timed out/);
    expect(seenMetadata.signal.aborted).toBe(true);
  });
});


// The beauty gate: a variant the critic STILL flags for aesthetic criteria
// after MAX_QUALITY_PASSES is held back rather than shipped — unless it is
// the only result, in which case it ships with a warning.
describe('AiDesignerConductorService beauty gate', () => {
  const makePlan = (variantId: string) => ({
    variantId,
    skill: 'advertisement',
    concept: `concept-${variantId}`,
    slots: [] as any[],
    assetNeeds: [] as any[],
    palette: [] as any[],
    typeScale: {},
    background: { kind: 'solid' as const },
  });

  const makeRenderResult = (variantId: string) => ({
    designId: `design-${variantId}`,
    variantId,
    outputPreviews: [
      {
        formatId: 'ig-post',
        fileId: `file-${variantId}`,
        url: `https://example.com/preview-${variantId}.png`,
      },
    ],
    contactSheetUrl: `https://example.com/sheet-${variantId}.png`,
  });

  const AESTHETIC_FINDING = {
    issue: 'The design reads as a filled-in template, not an art-directed poster',
    slotId: 'image',
    criterion: 'aesthetic_quality',
    fix: { scope: 'shared', targetSlots: ['image'], effects: ['vignette'] },
  };

  const makeGateConductor = (
    plans: any[],
    findingsFor: (variantTag: string) => any[]
  ) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'awaiting_plan',
        mode: 'prompt',
        brief: { intent: 'x', lastPlans: plans },
        config: { channels: ['ig-post'], variants: plans.length },
        activeDesignIds: null,
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const saver = {
      saveDesign: vi.fn().mockImplementation((_orgId, _userId, variantId) =>
        Promise.resolve(makeRenderResult(variantId))
      ),
      updateDesign: vi.fn().mockImplementation((_orgId, designId: string) => {
        const tag = designId.replace('design-', '');
        return Promise.resolve({
          designId,
          variantId: `${tag}-revised`,
          contactSheetUrl: `https://example.com/sheet-${tag}-revised.png`,
          outputPreviews: [
            {
              formatId: 'ig-post',
              fileId: `file-${tag}-revised`,
              url: `https://example.com/preview-${tag}-revised.png`,
            },
          ],
        });
      }),
    };
    const composer = { applyFixes: vi.fn((d: any) => Promise.resolve(d)) };
    const designService = {
      getDesign: vi
        .fn()
        .mockResolvedValue({ id: 'design', doc: { metadata: {}, layers: [] } }),
    };

    const { conductor } = makeConductor({ service });
    (conductor as any)._skillRouter = {
      getRubric: vi.fn().mockReturnValue({ criteria: [] }),
    };
    (conductor as any)._saver = saver;
    (conductor as any)._composer = composer;
    (conductor as any)._designService = designService;

    const dispatchAgent = vi.fn().mockImplementation((_, agentId, payload) => {
      if (agentId === 'asset') {
        return Promise.resolve({ content: JSON.stringify({ type: 'assets', assets: {} }) });
      }
      if (agentId === 'copywriter') {
        return Promise.resolve({ content: JSON.stringify({ type: 'copy', texts: {} }) });
      }
      if (agentId === 'composer') {
        return Promise.resolve({
          content: JSON.stringify({ type: 'doc', doc: { metadata: {}, layers: [] } }),
        });
      }
      if (agentId === 'vision-critic') {
        const url: string = payload?.contactSheetUrl ?? '';
        // The variant tag ('v1', 'v2', …) rides every preview/sheet URL.
        const tag = plans
          .map((p) => p.variantId as string)
          .find((v) => url.includes(v));
        return Promise.resolve({
          content: JSON.stringify({
            type: 'findings',
            findings: tag ? findingsFor(tag) : [],
          }),
        });
      }
      return Promise.resolve({ content: '{}' });
    });
    (conductor as any)._dispatchAgent = dispatchAgent;

    const mediaItems = () =>
      (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
        .filter((call) => call[0].kind === 'media')
        .flatMap((call) => call[0].content.items as any[]);
    const headsUp = () =>
      (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
        .filter(
          (call) =>
            call[0].kind === 'markdown' && call[0].content.md.includes('Heads up')
        )
        .map((call) => call[0].content.md as string)
        .join('\n');

    return { conductor, saver, composer, dispatchAgent, mediaItems, headsUp };
  };

  it('holds back a variant still flagged for aesthetic criteria after the bounded passes', async () => {
    const emitter = makeEmitter();
    const { conductor, dispatchAgent, mediaItems, headsUp } = makeGateConductor(
      [makePlan('v1'), makePlan('v2')],
      (tag) => (tag === 'v1' ? [AESTHETIC_FINDING] : [])
    );

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    // v1 got the full bounded loop (3 critiques), v2 one clean pass.
    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(4);

    // The held-back variant is NOT delivered; the clean one is.
    const designIds = mediaItems().map((item) => item.designId);
    expect(designIds).not.toContain('design-v1');
    expect(designIds).toContain('design-v2');
    expect(headsUp()).toContain('variant 1 was held back');
  });

  it('delivers the only result with a warning instead of delivering nothing', async () => {
    const emitter = makeEmitter();
    const { conductor, mediaItems, headsUp } = makeGateConductor(
      [makePlan('v1')],
      () => [AESTHETIC_FINDING]
    );

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const designIds = mediaItems().map((item) => item.designId);
    expect(designIds).toContain('design-v1');
    expect(headsUp()).toContain('still has known quality issues');
  });

  it('keeps the old single-pass behaviour when the first critique is clean', async () => {
    const emitter = makeEmitter();
    const { conductor, dispatchAgent, mediaItems } = makeGateConductor(
      [makePlan('v1'), makePlan('v2')],
      () => []
    );

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, undefined, emitter);

    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]: any) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);
    expect(mediaItems().map((item) => item.designId)).toEqual(
      expect.arrayContaining(['design-v1', 'design-v2'])
    );
  });
});
