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
    check: vi.fn().mockImplementation((input: any) =>
      Promise.resolve({
        ok: true,
        values: input.values ?? {},
        instruction: input.instruction,
      })
    ),
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
      policy,
      null as any
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

const PLANS = [
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

const makeSessionState = () => ({
  id: SESSION_ID,
  state: 'awaiting_plan' as const,
  mode: 'prompt' as const,
  brief: { intent: 'x', lastPlans: PLANS },
  activeDesignIds: null as string[] | null,
});

const makeSessionService = (sessionState: ReturnType<typeof makeSessionState>) => ({
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
});

// Pipeline stub that honors the variant narrowing the same way the real
// `_executePipeline` does: it renders exactly the plans it is handed.
const stubPipeline = (conductor: AiDesignerConductorService) =>
  ((conductor as any)._executePipeline = vi.fn().mockImplementation(
    (_sid, _ctx, _config, _brief, _emitter, presetPlans) => {
      const toRun = presetPlans ?? PLANS;
      return Promise.resolve(
        toRun.map((p: any) => ({
          designId: `design-${p.variantId}`,
          variantId: p.variantId,
          outputPreviews: [
            {
              formatId: 'ig-post',
              fileId: `file-${p.variantId}`,
              url: 'https://example.com/preview.png',
            },
          ],
          contactSheetUrl: 'https://example.com/sheet.png',
        }))
      );
    }
  ));

describe('AiDesignerConductorService delivery state machine', () => {
  it('runs the 3-variant accept/revise scenario', async () => {
    const emitter = makeEmitter();
    const designIds = ['design-v1', 'design-v2', 'design-v3'];
    const sessionState = makeSessionState();

    const { conductor, service, designService } = makeConductor({
      service: makeSessionService(sessionState),
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
    const pipeline = stubPipeline(conductor);

    // 1. Accept the whole plan set (no variantId → every plan executes).
    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      undefined,
      false,
      undefined,
      emitter
    );

    expect(sessionState.state).toBe('delivered');
    expect(sessionState.activeDesignIds).toEqual(designIds);
    expect(pipeline).toHaveBeenCalledWith(
      SESSION_ID,
      ctx,
      expect.anything(),
      expect.anything(),
      emitter,
      expect.arrayContaining([
        expect.objectContaining({ variantId: 'v1' }),
        expect.objectContaining({ variantId: 'v2' }),
        expect.objectContaining({ variantId: 'v3' }),
      ])
    );

    // 2. Delivery appends NO form message — it ends with a conversational
    //    markdown message telling the user how to revise and finish.
    const formCalls = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .filter((call) => call[0].kind === 'form');
    expect(formCalls.length).toBe(0);
    const deliveryNote = (
      service.appendMessage as ReturnType<typeof vi.fn>
    ).mock.calls.find(
      (call) =>
        call[0].kind === 'markdown' &&
        call[0].agent === 'conversationalist' &&
        call[0].content.md.includes('looks good')
    );
    expect(deliveryNote).toBeDefined();

    // 3. A chat "looks good" saves a template per delivered design.
    sessionState.mode = 'chat';
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({ type: 'accept', text: 'Great — enjoy!' }),
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'looks good', emitter);

    expect(designService.createTemplate).toHaveBeenCalledTimes(3);
    const savedTemplateArgs = (
      designService.createTemplate as ReturnType<typeof vi.fn>
    ).mock.calls.map((call) => call[0]);
    expect(savedTemplateArgs[0].organizationId).toBe(ORG_ID);
    expect(savedTemplateArgs[0].doc.metadata.source).toBe('ai-designer');
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({ text: 'Templates saved.' }),
      })
    );

    // 4. The "no template" phrasing opts out of the auto-save. The accept is
    //    matched deterministically (no classifier round-trip), so the reply
    //    is the default confirmation, not a classifier phrasing.
    (designService.createTemplate as ReturnType<typeof vi.fn>).mockClear();
    (conductor as any)._dispatchAgent = vi.fn();

    await conductor.handleMessage(SESSION_ID, ctx, 'looks good, no template', emitter);

    expect((conductor as any)._dispatchAgent).not.toHaveBeenCalled();
    expect(designService.createTemplate).not.toHaveBeenCalled();
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'Great! Let me know if you need any other changes.',
        }),
      })
    );

    // 5. A chat revision honors the conversationalist's extracted target.
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        type: 'revision',
        revision: {
          instruction: 'make the headline bigger',
          targetDesignId: 'design-v3',
          scope: 'shared',
        },
      }),
    });
    const reviseDesign = ((conductor as any)._reviseDesign = vi
      .fn()
      .mockResolvedValue({
        designId: 'design-v3-revised',
        variantId: 'revised',
        outputPreviews: [],
      }));

    await conductor.handleMessage(SESSION_ID, ctx, 'make the headline bigger on variant 3', emitter);

    expect(reviseDesign).toHaveBeenCalledWith(
      SESSION_ID,
      ctx,
      'design-v3',
      expect.objectContaining({ instruction: 'make the headline bigger' }),
      emitter
    );
    expect(sessionState.state).toBe('delivered');
    expect(sessionState.activeDesignIds).toContain('design-v3-revised');

    // 6. A revise call in the wrong state is rejected.
    sessionState.state = 'intake';
    emitter.toSession.mockClear();

    await conductor.handleRevise(
      SESSION_ID,
      ctx,
      { instruction: 'make it bigger', targetDesignId: 'design-v3', nonce: 'n1' },
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

  it('executes exactly one plan when a single variantId is accepted', async () => {
    const emitter = makeEmitter();
    const sessionState = makeSessionState();

    const { conductor } = makeConductor({
      service: makeSessionService(sessionState),
      designService: {
        getDesign: vi.fn().mockResolvedValue({ id: 'design-v3', doc: { metadata: {} } }),
        createTemplate: vi.fn().mockResolvedValue(undefined),
      },
    });
    const pipeline = stubPipeline(conductor);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      'v3',
      false,
      undefined,
      emitter
    );

    expect(pipeline).toHaveBeenCalledTimes(1);
    const presetPlans = pipeline.mock.calls[0][5];
    expect(presetPlans).toHaveLength(1);
    expect(presetPlans[0].variantId).toBe('v3');
    expect(sessionState.state).toBe('delivered');
    expect(sessionState.activeDesignIds).toEqual(['design-v3']);
  });

  it('creates no template when accept:plan omits saveTemplate', async () => {
    const emitter = makeEmitter();
    const sessionState = makeSessionState();

    const { conductor, designService } = makeConductor({
      service: makeSessionService(sessionState),
    });
    stubPipeline(conductor);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      undefined,
      undefined,
      undefined,
      emitter
    );

    expect(sessionState.state).toBe('delivered');
    expect(designService.createTemplate).not.toHaveBeenCalled();
  });

  it('saves a template when accept:plan explicitly opts in', async () => {
    const emitter = makeEmitter();
    const sessionState = makeSessionState();

    const { conductor, designService } = makeConductor({
      service: makeSessionService(sessionState),
    });
    stubPipeline(conductor);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      undefined,
      true,
      undefined,
      emitter
    );

    expect(designService.createTemplate).toHaveBeenCalledTimes(1);
  });

  it('labels delivery media items Variant N · formatId', async () => {
    const emitter = makeEmitter();
    const sessionState = makeSessionState();

    const { conductor, service } = makeConductor({
      service: makeSessionService(sessionState),
    });
    stubPipeline(conductor);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      undefined,
      false,
      undefined,
      emitter
    );

    const mediaCall = (service.appendMessage as ReturnType<typeof vi.fn>).mock.calls
      .find((call) => call[0].kind === 'media');
    expect(mediaCall).toBeDefined();
    const captions = mediaCall[0].content.items.map((item: any) => item.caption);
    expect(captions).toEqual([
      'Variant 1 · ig-post',
      'Variant 2 · ig-post',
      'Variant 3 · ig-post',
    ]);
  });

  it('_appendProgress persists the row and emits live progress', async () => {
    const emitter = makeEmitter();
    const { conductor, service } = makeConductor({
      service: makeSessionService(makeSessionState()),
    });

    await (conductor as any)._appendProgress(
      SESSION_ID,
      'composer',
      'executing',
      emitter
    );

    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'agent',
        agent: 'composer',
        kind: 'progress',
        content: { kind: 'progress', agent: 'composer', phase: 'executing' },
      })
    );
    expect(emitter.progress).toHaveBeenCalledWith('composer', 'executing');
    // The persisted row itself is not broadcast — hydration reads it from the DB.
    expect(emitter.toSession).not.toHaveBeenCalled();
  });

  it('_reviseDesign emits live progress and a preview of the revision', async () => {
    const emitter = makeEmitter();
    const sessionState = {
      ...makeSessionState(),
      state: 'delivered' as const,
      activeDesignIds: ['design-v1'],
      brief: { intent: 'x', skillId: 'meme' },
    };
    const render = {
      designId: 'design-v1-revised',
      variantId: 'revised-1',
      outputPreviews: [
        {
          formatId: 'ig-post',
          fileId: 'file-revised',
          url: 'https://example.com/revised.png',
        },
      ],
      // No contactSheetUrl — the vision re-check is skipped.
    };

    const { conductor } = makeConductor({
      service: makeSessionService(sessionState),
    });
    (conductor as any)._composer = {
      reviseByInstruction: vi.fn().mockResolvedValue({ layers: [] }),
    };
    (conductor as any)._saver = {
      saveDesign: vi.fn().mockResolvedValue(render),
      updateDesign: vi.fn(),
    };
    (conductor as any)._designService = {
      getDesign: vi.fn().mockResolvedValue({ id: 'design-v1', doc: { layers: [] } }),
    };

    const result = await (conductor as any)._reviseDesign(
      SESSION_ID,
      ctx,
      'design-v1',
      { instruction: 'make it bigger', scope: 'shared' },
      emitter
    );

    expect(result).toBe(render);
    expect(emitter.progress).toHaveBeenCalledWith(
      'composer',
      'Applying revision',
      undefined,
      'make it bigger'
    );
    expect(emitter.progress).toHaveBeenCalledWith('composer', 'Saving');
    expect(emitter.preview).toHaveBeenCalledWith(render);
  });
});

describe('AiDesignerConductorService _fixContrastOverImagery', () => {
  const makeRender = (withViolations: boolean): any => ({
    designId: 'design-v1',
    variantId: 'v1',
    outputPreviews: [],
    ...(withViolations
      ? {
          contrastViolations: [
            {
              outputIndex: 0,
              elementId: 't1',
              originId: 'headline',
              fill: '#777777',
              ratio: 1.2,
              backdropLuma: 0.5,
            },
          ],
        }
      : {}),
  });

  it('runs one bounded fix pass and exactly one -contrast re-save when violations are reported', async () => {
    const { conductor } = makeConductor();
    const doc = { layers: [] };
    const fixedDoc = { layers: ['fixed'] };
    const render = makeRender(true);
    const reRendered = {
      designId: 'design-v1',
      variantId: 'ignored-by-caller',
      outputPreviews: [{ formatId: 'ig-post', fileId: 'f2', url: 'u2' }],
    };
    const fixContrast = vi
      .fn()
      .mockReturnValue({ doc: fixedDoc, notes: ['flipped "headline"'] });
    const updateDesign = vi.fn().mockResolvedValue(reRendered);
    (conductor as any)._composer = { fixContrast };
    (conductor as any)._saver = { updateDesign };
    const notes: string[] = [];

    const result = await (conductor as any)._fixContrastOverImagery(
      ctx,
      'design-v1',
      doc,
      render,
      'meme-v1',
      null,
      notes,
      'variant 1 (ig-post)'
    );

    expect(fixContrast).toHaveBeenCalledTimes(1);
    expect(fixContrast).toHaveBeenCalledWith(doc, render.contrastViolations);
    expect(updateDesign).toHaveBeenCalledTimes(1);
    expect(updateDesign).toHaveBeenCalledWith(
      ORG_ID,
      'design-v1',
      'v1-contrast',
      fixedDoc,
      { name: 'meme-v1', saveFolderId: null }
    );
    expect(result.doc).toBe(fixedDoc);
    // The re-render keeps the original variant id for the caller.
    expect(result.render.variantId).toBe('v1');
    expect(result.render.outputPreviews).toBe(reRendered.outputPreviews);
    expect(notes).toEqual([
      'variant 1 (ig-post) needed an automatic contrast fix over the imagery',
    ]);
  });

  it('does nothing when no violations are reported', async () => {
    const { conductor } = makeConductor();
    const doc = { layers: [] };
    const render = makeRender(false);
    const fixContrast = vi.fn();
    const updateDesign = vi.fn();
    (conductor as any)._composer = { fixContrast };
    (conductor as any)._saver = { updateDesign };
    const notes: string[] = [];

    const result = await (conductor as any)._fixContrastOverImagery(
      ctx,
      'design-v1',
      doc,
      render,
      'meme-v1',
      null,
      notes,
      'variant 1 (ig-post)'
    );

    expect(fixContrast).not.toHaveBeenCalled();
    expect(updateDesign).not.toHaveBeenCalled();
    expect(result.doc).toBe(doc);
    expect(result.render).toBe(render);
    expect(notes).toEqual([]);
  });
});

describe('AiDesignerConductorService deterministic delivered accept', () => {
  const makeDeliveredSetup = (brief: Record<string, unknown> = {}) => {
    const service = {
      getSessionForUser: vi.fn().mockResolvedValue({
        id: SESSION_ID,
        state: 'delivered',
        mode: 'chat',
        brief: { intent: 'x', skillId: 'meme', ...brief },
        activeDesignIds: ['design-A', 'design-B'],
      }),
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'msg-1' }),
    };
    const designService = {
      getDesign: vi.fn().mockImplementation((_orgId: string, id: string) =>
        Promise.resolve({ id, doc: { metadata: {} } })
      ),
      createTemplate: vi.fn().mockResolvedValue(undefined),
    };
    const { conductor } = makeConductor({ service, designService });
    return { conductor, service, designService };
  };

  it.each([
    'looks good',
    'Looks good!',
    'perfect',
    'great',
    'love it',
    'LGTM',
    'done',
    'yes',
    'yep',
    'save it',
    'accept',
    'finish',
  ])('accepts "%s" deterministically — no classifier dispatch', async (text) => {
    const emitter = makeEmitter();
    const { conductor, designService } = makeDeliveredSetup();
    const dispatchAgent = ((conductor as any)._dispatchAgent = vi.fn());

    await conductor.handleMessage(SESSION_ID, ctx, text, emitter);

    expect(dispatchAgent).not.toHaveBeenCalled();
    // No lastDeliveredDesignIds on the brief → legacy fallback: one template
    // per active design.
    expect(designService.createTemplate).toHaveBeenCalledTimes(2);
  });

  it.each([
    'looks good, no template',
    "perfect — don't save it",
    'done. dont save',
  ])('accepts "%s" with the opt-out clause — no template, no dispatch', async (text) => {
    const emitter = makeEmitter();
    const { conductor, service, designService } = makeDeliveredSetup();
    const dispatchAgent = ((conductor as any)._dispatchAgent = vi.fn());

    await conductor.handleMessage(SESSION_ID, ctx, text, emitter);

    expect(dispatchAgent).not.toHaveBeenCalled();
    expect(designService.createTemplate).not.toHaveBeenCalled();
    expect(service.appendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          text: 'Great! Let me know if you need any other changes.',
        }),
      })
    );
  });

  it('sends an instruction-bearing message to the classifier instead', async () => {
    const emitter = makeEmitter();
    const { conductor, designService } = makeDeliveredSetup();
    const dispatchAgent = ((conductor as any)._dispatchAgent = vi
      .fn()
      .mockResolvedValue({
        content: JSON.stringify({
          type: 'revision',
          revision: { instruction: 'make it darker', scope: 'shared' },
        }),
      }));
    const reviseDesign = ((conductor as any)._reviseDesign = vi
      .fn()
      .mockResolvedValue({
        designId: 'design-A2',
        variantId: 'revised',
        outputPreviews: [],
      }));

    await conductor.handleMessage(
      SESSION_ID,
      ctx,
      'looks good but make it darker',
      emitter
    );

    expect(dispatchAgent).toHaveBeenCalledTimes(1);
    expect(reviseDesign).toHaveBeenCalled();
    expect(designService.createTemplate).not.toHaveBeenCalled();
  });

  it('saves templates only for the latest delivery ids, not every active design', async () => {
    const emitter = makeEmitter();
    const { conductor, designService } = makeDeliveredSetup({
      lastDeliveredDesignIds: ['design-B'],
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'looks good', emitter);

    expect(designService.createTemplate).toHaveBeenCalledTimes(1);
    expect(designService.getDesign).toHaveBeenCalledWith(ORG_ID, 'design-B');
    expect(designService.getDesign).not.toHaveBeenCalledWith(ORG_ID, 'design-A');
  });

  it('drops a lastDeliveredDesignIds id that is no longer active', async () => {
    const emitter = makeEmitter();
    const { conductor, designService } = makeDeliveredSetup({
      lastDeliveredDesignIds: ['design-gone'],
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'looks good', emitter);

    // Nothing deliverable survives the intersection → legacy fallback saves
    // the active designs (matches pre-field behavior).
    expect(designService.createTemplate).toHaveBeenCalledTimes(2);
    expect(designService.getDesign).not.toHaveBeenCalledWith(
      ORG_ID,
      'design-gone'
    );
  });

  it('persists lastDeliveredDesignIds with the delivered state after a plan executes', async () => {
    const emitter = makeEmitter();
    const sessionState = makeSessionState();
    const { conductor, service } = makeConductor({
      service: makeSessionService(sessionState),
    });
    stubPipeline(conductor);

    await conductor.handleAcceptPlan(
      SESSION_ID,
      ctx,
      'reply-plan',
      undefined,
      false,
      undefined,
      emitter
    );

    expect((sessionState.brief as any).lastDeliveredDesignIds).toEqual([
      'design-v1',
      'design-v2',
      'design-v3',
    ]);
    expect(service.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      ORG_ID,
      USER_ID,
      expect.objectContaining({
        state: 'delivered',
        brief: expect.objectContaining({
          lastDeliveredDesignIds: ['design-v1', 'design-v2', 'design-v3'],
        }),
      })
    );
  });

  it('scopes lastDeliveredDesignIds to the revision after a revise redelivery', async () => {
    const emitter = makeEmitter();
    const sessionState = {
      ...makeSessionState(),
      state: 'delivered' as const,
      mode: 'chat' as const,
      brief: { intent: 'x', skillId: 'meme' },
      activeDesignIds: ['design-A', 'design-B'],
    };
    const { conductor } = makeConductor({
      service: makeSessionService(sessionState),
    });
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({
        type: 'revision',
        revision: { instruction: 'make it darker', scope: 'shared' },
      }),
    });
    (conductor as any)._reviseDesign = vi.fn().mockResolvedValue({
      designId: 'design-A2',
      variantId: 'revised',
      outputPreviews: [],
    });

    await conductor.handleMessage(SESSION_ID, ctx, 'make it darker', emitter);

    expect(sessionState.activeDesignIds).toEqual([
      'design-A',
      'design-B',
      'design-A2',
    ]);
    expect((sessionState.brief as any).lastDeliveredDesignIds).toEqual(['design-A2']);
    // The accept that follows saves a template for the revision only.
    const designService = (conductor as any)._designService;
    await conductor.handleMessage(SESSION_ID, ctx, 'looks good', emitter);
    expect(designService.createTemplate).toHaveBeenCalledTimes(1);
    expect(designService.getDesign).toHaveBeenCalledWith(ORG_ID, 'design-A2');
  });
});
