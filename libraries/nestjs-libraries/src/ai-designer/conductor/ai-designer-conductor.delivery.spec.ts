import { describe, it, expect, vi } from 'vitest';
import { AiDesignerConductorService } from './ai-designer-conductor.service';

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

const makeConductor = (overrides: {
  service?: any;
  designService?: any;
  budgetGuard?: any;
  policy?: any;
} = {}) => {
  const service = overrides.service ?? {
    getSessionForUser: vi.fn(),
    updateSession: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
  };
  const designService = overrides.designService ?? {
    getDesign: vi.fn().mockResolvedValue({ id: 'design-1', doc: {} }),
    createTemplate: vi.fn().mockResolvedValue(undefined),
  };
  const budgetGuard = overrides.budgetGuard ?? {
    checkStartBudget: vi.fn().mockResolvedValue({ allowed: true }),
  };
  const policy = overrides.policy ?? {
    check: vi.fn().mockResolvedValue({ ok: true, values: {} }),
  };

  return {
    conductor: new AiDesignerConductorService(
      service,
      null as any,
      null as any,
      designService,
      null as any,
      budgetGuard,
      null as any,
      policy
    ),
    service,
    designService,
  };
};

const makeEmitter = () => ({
  toSession: vi.fn(),
  progress: vi.fn(),
  preview: vi.fn(),
  error: vi.fn(),
});

const ctx = { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID };

describe('AiDesignerConductorService delivery state machine', () => {
  it('runs the 3-variant accept/revise scenario', async () => {
    const emitter = makeEmitter();
    const designIds = ['design-A', 'design-B', 'design-C'];
    const plans = [
      {
        variantId: 'v1',
        skill: 'meme',
        concept: 'c1',
        slots: [],
        assetNeeds: [],
        palette: [],
        typeScale: {},
        background: { kind: 'solid' as const },
      },
      {
        variantId: 'v2',
        skill: 'meme',
        concept: 'c2',
        slots: [],
        assetNeeds: [],
        palette: [],
        typeScale: {},
        background: { kind: 'solid' as const },
      },
      {
        variantId: 'v3',
        skill: 'meme',
        concept: 'c3',
        slots: [],
        assetNeeds: [],
        palette: [],
        typeScale: {},
        background: { kind: 'solid' as const },
      },
    ];

    const sessionState = {
      id: SESSION_ID,
      state: 'awaiting_plan' as const,
      mode: 'prompt' as const,
      brief: { intent: 'x', lastPlans: plans },
      activeDesignIds: null as string[] | null,
    };

    const { conductor, service, designService } = makeConductor({
      service: {
        getSessionForUser: vi.fn().mockImplementation(() => {
          return Promise.resolve({ ...sessionState });
        }),
        updateSession: vi.fn().mockImplementation((_sid, _oid, _uid, update) => {
          Object.assign(sessionState, update);
          if (update.brief) {
            sessionState.brief = { ...sessionState.brief, ...update.brief };
          }
          return Promise.resolve(undefined);
        }),
        appendMessage: vi.fn().mockResolvedValue({ id: 'msg-id' }),
      },
      designService: {
        getDesign: vi.fn().mockImplementation((orgId: string, id: string) => {
          if (designIds.includes(id)) {
            return Promise.resolve({ id, doc: { metadata: {} } });
          }
          return Promise.resolve(null);
        }),
        createTemplate: vi.fn().mockResolvedValue(undefined),
      },
    });

    // Bypass the real pipeline — we only need the delivery/revise state machine.
    (conductor as any)._executePipeline = vi.fn().mockResolvedValue(
      designIds.map((designId, i) => ({
        designId,
        variantId: `v${i + 1}`,
        outputPreviews: [
          {
            formatId: 'ig-post',
            fileId: `file-${i}`,
            url: 'https://example.com/preview.png',
          },
        ],
        contactSheetUrl: 'https://example.com/sheet.png',
      }))
    );

    // 1. Accept plan variant 3.
    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      'v3',
      false,
      emitter
    );

    expect(sessionState.state).toBe('delivered');
    expect(sessionState.activeDesignIds).toEqual(designIds);

    // 2. Delivery form uses designId as radio value.
    const formCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter(
        (call) =>
          call[0].kind === 'form' && call[0].agent === 'conversationalist'
      );
    expect(formCalls.length).toBe(1);
    const radioField = formCalls[0][0].content.fields.find(
      (f: any) => f.name === 'variantId'
    );
    expect(radioField.options.map((o: any) => o.value)).toEqual(designIds);

    // 3. Accept variant 3 from the delivery form.
    await (conductor as any)._handleDeliveryFormSubmit(
      SESSION_ID,
      ctx,
      'delivery-1',
      { action: 'accept', variantId: 'design-C' },
      emitter
    );

    expect(designService.createTemplate).toHaveBeenCalledTimes(1);
    const templateArgs = (designService.createTemplate as ReturnType<typeof vi.fn>)
      .mock.calls[0][0];
    expect(templateArgs.organizationId).toBe(ORG_ID);
    expect(templateArgs.doc.metadata.source).toBe('ai-designer');

    // 4. Double-submit the same delivery form — no duplicate template.
    await (conductor as any)._handleDeliveryFormSubmit(
      SESSION_ID,
      ctx,
      'delivery-1',
      { action: 'accept', variantId: 'design-C' },
      emitter
    );

    expect(designService.createTemplate).toHaveBeenCalledTimes(1);
    expect(sessionState.brief.answeredPromptIds).toContain('delivery-1');

    // 5. Request a revision of variant 3.
    await (conductor as any)._handleDeliveryFormSubmit(
      SESSION_ID,
      ctx,
      'delivery-2',
      { action: 'revise', variantId: 'design-C' },
      emitter
    );

    expect(sessionState.brief.pendingReviseTarget).toBe('design-C');

    // 6. A revise call in the wrong state is rejected.
    sessionState.state = 'intake';
    emitter.toSession.mockClear();

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-C', nonce: 'n1' },
      emitter
    );

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          kind: 'text',
          text: 'This design is not available for revision right now.',
        }),
      })
    );
  });
});
