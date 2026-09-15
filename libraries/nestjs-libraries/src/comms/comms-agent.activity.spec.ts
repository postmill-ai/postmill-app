import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommsAgentActivity } from './comms-agent.activity';

const PARAMS = {
  orgId: 'org-1',
  userId: 'user-1',
  linkId: 'link-1',
  externalThreadKey: '777',
  text: 'hello',
};

describe('CommsAgentActivity', () => {
  let activity: CommsAgentActivity;
  let budget: any;
  let mastraService: any;
  let organizationService: any;
  let aiModelProvider: any;
  let telemetry: any;
  let generateMock: any;
  let saveMessagesMock: any;
  let gate: any;

  beforeEach(() => {
    budget = { checkBudget: vi.fn().mockResolvedValue({ allowed: true }) };
    generateMock = vi.fn().mockResolvedValue({ text: 'reply text' });
    saveMessagesMock = vi.fn().mockResolvedValue({ messages: [] });
    mastraService = {
      mastra: vi.fn().mockResolvedValue({
        getAgent: () => ({
          generate: generateMock,
          getMemory: async () => ({ saveMessages: saveMessagesMock }),
        }),
      }),
    };
    organizationService = {
      getOrgById: vi.fn().mockResolvedValue({ id: 'org-1', name: 'Org' }),
    };
    aiModelProvider = {
      resolveConfigForScope: vi.fn().mockResolvedValue({ provider: 'openai' }),
    };
    telemetry = {
      startSpan: vi.fn(async (_name: string, fn: any) =>
        fn({ setAttribute: vi.fn() }),
      ),
    };
    gate = {
      getPending: vi.fn().mockResolvedValue(null),
      executeConfirmed: vi.fn().mockResolvedValue({ output: ['post-1'] }),
    };
    activity = new CommsAgentActivity(
      budget,
      mastraService,
      organizationService,
      aiModelProvider,
      telemetry,
      gate,
    );
  });

  it('builds a deterministic thread id', () => {
    expect(activity.threadId('link-1', '777')).toBe('comms:link-1:777');
    expect(activity.threadId('link-1', '777')).toBe(activity.threadId('link-1', '777'));
  });

  it('generates as the real linked user with access mode comms', async () => {
    const result = await activity.generateReply(PARAMS);
    expect(result.text).toBe('reply text');
    const [, options] = generateMock.mock.calls[0];
    expect(options.memory).toEqual({ resource: 'org-1', thread: 'comms:link-1:777' });
    const ctx = options.requestContext;
    expect(JSON.parse(ctx.get('user'))).toEqual({ id: 'user-1' });
    expect(JSON.parse(ctx.get('access'))).toEqual({ mode: 'comms' });
    expect(ctx.get('ui')).toBe('false');
    // The confirmation gate parks outward actions against these two keys.
    expect(ctx.get('thread')).toBe('comms:link-1:777');
    expect(ctx.get('linkId')).toBe('link-1');
    expect(ctx.get('pendingConfirmation')).toBeUndefined();
    expect(result.threadId).toBe('comms:link-1:777');
    expect(result.pendingConfirmation).toBeUndefined();
  });

  it('tells the model about a confirmation that was already pending before the turn', async () => {
    gate.getPending.mockResolvedValue({
      toolId: 'schedulePostTool',
      summary: '1 post(s): Schedule on channel int-1',
      createdAt: Date.now() - 60_000,
    });
    await activity.generateReply(PARAMS);
    const ctx = generateMock.mock.calls[0][1].requestContext;
    expect(JSON.parse(ctx.get('pendingConfirmation'))).toEqual({
      toolId: 'schedulePostTool',
      summary: '1 post(s): Schedule on channel int-1',
    });
  });

  it('reports pendingConfirmation when the turn parked an outward action', async () => {
    gate.getPending
      .mockResolvedValueOnce(null) // before the turn
      .mockResolvedValueOnce({
        toolId: 'schedulePostTool',
        summary: 'Schedule on channel int-1',
        createdAt: Date.now() + 1, // written during the turn
      });
    const result = await activity.generateReply(PARAMS);
    expect(result.pendingConfirmation).toEqual({
      toolId: 'schedulePostTool',
      summary: 'Schedule on channel int-1',
    });
  });

  it('does not report a stale pending action as new', async () => {
    const stale = { toolId: 'deletePost', summary: 'x', createdAt: Date.now() - 60_000 };
    gate.getPending.mockResolvedValue(stale);
    const result = await activity.generateReply(PARAMS);
    expect(result.pendingConfirmation).toBeUndefined();
  });

  describe('recordExchange', () => {
    it('writes the user/assistant pair into the thread memory as v2 messages', async () => {
      await activity.recordExchange({
        orgId: 'org-1',
        threadId: 'comms:link-1:777',
        userText: 'yes',
        assistantText: 'Done — 1 post(s) created.',
      });
      const { messages } = saveMessagesMock.mock.calls[0][0];
      expect(messages).toHaveLength(2);
      expect(messages[0]).toMatchObject({
        role: 'user',
        threadId: 'comms:link-1:777',
        resourceId: 'org-1',
        content: { format: 2, parts: [{ type: 'text', text: 'yes' }] },
      });
      expect(messages[1]).toMatchObject({ role: 'assistant', content: { content: 'Done — 1 post(s) created.' } });
      expect(messages[0].createdAt.getTime()).toBeLessThan(messages[1].createdAt.getTime());
    });

    it('never throws when memory is unavailable', async () => {
      saveMessagesMock.mockRejectedValue(new Error('pg down'));
      await expect(
        activity.recordExchange({ orgId: 'org-1', threadId: 't', userText: 'no', assistantText: 'x' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('runConfirmedAction', () => {
    const pending = {
      confirmationId: 'abc123abc123',
      toolId: 'schedulePostTool',
      args: { socialPost: [] },
      orgId: 'org-1',
      userId: 'user-1',
      linkId: 'link-1',
      threadId: 'comms:link-1:777',
      summary: 's',
      createdAt: 1,
      expiresAt: Date.now() + 1000,
    };
    const base = { orgId: 'org-1', userId: 'user-1', linkId: 'link-1', threadId: 'comms:link-1:777' };

    it('re-invokes the parked call with access {mode: comms, confirmed}', async () => {
      const outcome = await activity.runConfirmedAction({ ...base, pending });
      expect(outcome).toEqual({ ok: true, result: { output: ['post-1'] } });
      const [parked, ctx] = gate.executeConfirmed.mock.calls[0];
      expect(parked).toBe(pending);
      expect(JSON.parse(ctx.get('access'))).toEqual({ mode: 'comms', confirmed: 'abc123abc123' });
      expect(ctx.get('thread')).toBe('comms:link-1:777');
      expect(JSON.parse(ctx.get('user'))).toEqual({ id: 'user-1' });
      expect(mastraService.mastra).toHaveBeenCalled(); // registry populated
    });

    it.each([
      ['org', { ...pending, orgId: 'other' }],
      ['user', { ...pending, userId: 'other' }],
      ['link', { ...pending, linkId: 'other' }],
    ])('refuses a pending action from another %s', async (_l, foreign) => {
      const outcome = await activity.runConfirmedAction({ ...base, pending: foreign });
      expect(outcome.ok).toBe(false);
      expect(gate.executeConfirmed).not.toHaveBeenCalled();
    });

    it('collapses execution errors into ok:false without leaking internals', async () => {
      gate.executeConfirmed.mockRejectedValue(new Error('prisma exploded sk-secret'));
      const outcome = await activity.runConfirmedAction({ ...base, pending });
      expect(outcome.ok).toBe(false);
      expect(outcome.error).not.toContain('sk-secret');
    });

    it('honours the budget before executing', async () => {
      budget.checkBudget.mockResolvedValue({ allowed: false });
      const outcome = await activity.runConfirmedAction({ ...base, pending });
      expect(outcome.ok).toBe(false);
      expect(gate.executeConfirmed).not.toHaveBeenCalled();
    });
  });

  it('returns a budget message without generating when the budget is exhausted', async () => {
    budget.checkBudget.mockResolvedValue({ allowed: false, reason: 'cap' });
    const result = await activity.generateReply(PARAMS);
    expect(result.text).toContain('budget');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('returns a not-configured message when the org has no AI provider', async () => {
    aiModelProvider.resolveConfigForScope.mockResolvedValue(null);
    const result = await activity.generateReply(PARAMS);
    expect(result.text).toContain('not configured');
    expect(generateMock).not.toHaveBeenCalled();
  });

  it('collapses generate errors into a short apology (no internals leaked)', async () => {
    generateMock.mockRejectedValue(new Error('provider exploded: sk-secret'));
    const result = await activity.generateReply(PARAMS);
    expect(result.text).not.toContain('sk-secret');
    expect(result.text).toContain('Sorry');
  });

  it('falls back to the apology when the agent returns empty text', async () => {
    generateMock.mockResolvedValue({ text: '   ' });
    const result = await activity.generateReply(PARAMS);
    expect(result.text).toContain('Sorry');
  });
});
