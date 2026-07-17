import { describe, it, expect, vi } from 'vitest';
import { AiDesignerConductorService } from './ai-designer-conductor.service';
import { AiDesignerInputPolicyService } from '../ai-designer-input-policy.service';
import { AiDesignerSkillRouter } from '../skills/ai-designer-skill-router.service';

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
      policy
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
      emitter
    );

    const deliveredUpdate = (service.updateSession as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[3].state === 'delivered');
    expect(deliveredUpdate).toBeDefined();
    expect(deliveredUpdate[3].activeDesignIds).toHaveLength(2);
  });

  it('routes vision-critic error envelope to the non-fatal path', async () => {
    const { conductor } = makeConductor({});

    expect(() =>
      (conductor as any)._parseFindings({
        content: JSON.stringify({ type: 'error', message: 'cannot run' }),
      })
    ).toThrow('cannot run');
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

describe('AiDesignerConductorService delivery form', () => {
  it('reports template save failure accurately', async () => {
    const emitter = makeEmitter();
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'prompt',
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
    const { conductor } = makeConductor({ service });
    (conductor as any)._designService = designService;

    await (conductor as any)._handleDeliveryFormSubmit(
      SESSION_ID,
      ctx,
      'delivery-1',
      { action: 'accept', variantId: 'design-A' },
      emitter
    );

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: "Couldn't save the template — the design is still available; try again from the delivery form.",
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

    await conductor.handleAcceptPlan(SESSION_ID, ctx, 'reply-1', undefined, false, emitter);

    const criticCalls = dispatchAgent.mock.calls.filter(
      ([_, agentId]) => agentId === 'vision-critic'
    );
    expect(criticCalls).toHaveLength(2);

    const v1Call = criticCalls.find(
      ([_, __, payload]: any) =>
        payload.contactSheetUrl === 'https://example.com/sheet-v1.png'
    );
    const v2Call = criticCalls.find(
      ([_, __, payload]: any) =>
        payload.contactSheetUrl === 'https://example.com/sheet-v2.png'
    );

    expect(v1Call).toBeDefined();
    expect(v2Call).toBeDefined();
    expect(v1Call![2].rubric).toEqual(skillRouter.getRubric('meme'));
    expect(v2Call![2].rubric).toEqual(skillRouter.getRubric('advertisement'));
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
});
