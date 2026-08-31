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

  beforeEach(() => {
    budget = { checkBudget: vi.fn().mockResolvedValue({ allowed: true }) };
    generateMock = vi.fn().mockResolvedValue({ text: 'reply text' });
    mastraService = {
      mastra: vi.fn().mockResolvedValue({
        getAgent: () => ({ generate: generateMock }),
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
    activity = new CommsAgentActivity(
      budget,
      mastraService,
      organizationService,
      aiModelProvider,
      telemetry,
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
