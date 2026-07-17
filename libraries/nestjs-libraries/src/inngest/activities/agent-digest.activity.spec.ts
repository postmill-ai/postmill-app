import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentDigestActivity } from './agent-digest.activity';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { BudgetService } from '@gitroom/nestjs-libraries/ai/governance/budget.service';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { NotificationPreferenceService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification-preference.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';
import { Organization } from '@prisma/client';

describe('AgentDigestActivity', () => {
  let activity: AgentDigestActivity;

  const mockGenerate = vi.fn().mockResolvedValue({ text: 'weekly plan' });
  const mockGetAgent = vi.fn().mockReturnValue({ generate: mockGenerate });
  const mockMastra = vi.fn().mockResolvedValue({
    getAgent: mockGetAgent,
  });

  const mastraService = {
    mastra: mockMastra,
  } as unknown as MastraService;

  const budgetService = {
    checkBudget: vi.fn().mockResolvedValue({ allowed: true }),
  } as unknown as BudgetService;

  const preferenceService = {
    orgHasCategoryEnabled: vi.fn().mockResolvedValue(true),
  } as unknown as NotificationPreferenceService;

  const notificationService = {
    notify: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationService;

  const organizationService = {
    getOrgById: vi.fn().mockResolvedValue({
      id: 'org-1',
      name: 'Test Org',
    } as Organization),
  } as unknown as OrganizationService;

  const aiModelProvider = {
    resolveConfigForScope: vi.fn().mockResolvedValue({ providerId: 'openai' }),
  } as unknown as AIModelProvider;

  const telemetryService = {
    startSpan: vi.fn().mockImplementation(async (_name, fn) => fn({ setAttribute: vi.fn() })),
  } as unknown as TelemetryService;

  beforeEach(() => {
    vi.clearAllMocks();
    activity = new AgentDigestActivity(
      preferenceService,
      budgetService,
      mastraService,
      notificationService,
      organizationService,
      aiModelProvider,
      telemetryService,
    );
  });

  describe('generate', () => {
    it('skips when no org member has the agent category enabled', async () => {
      vi.mocked(preferenceService.orgHasCategoryEnabled).mockResolvedValueOnce(false);

      const result = await activity.generate('org-1');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('no_opt_in');
      expect(budgetService.checkBudget).not.toHaveBeenCalled();
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('skips when the org is over budget', async () => {
      vi.mocked(budgetService.checkBudget).mockResolvedValueOnce({
        allowed: false,
        reason: 'monthly cap exceeded',
      });

      const result = await activity.generate('org-1');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('budget_exceeded');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('skips when the organization is not found', async () => {
      vi.mocked(organizationService.getOrgById).mockResolvedValueOnce(null);

      const result = await activity.generate('org-1');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('org_not_found');
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it('skips cleanly (no throw) when the org has no active AI provider', async () => {
      vi.mocked(aiModelProvider.resolveConfigForScope).mockResolvedValueOnce(null);

      const result = await activity.generate('org-1');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('ai_not_configured');
      expect(aiModelProvider.resolveConfigForScope).toHaveBeenCalledWith(
        'agent',
        'org-1'
      );
      // The LLM must never run when the provider is unconfigured.
      expect(mockGenerate).not.toHaveBeenCalled();
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('wraps generation in a telemetry span', async () => {
      await activity.generate('org-1');

      expect(telemetryService.startSpan).toHaveBeenCalledWith(
        'agent.digest.generate',
        expect.any(Function),
        { 'ai.scope': 'agent' },
      );
    });

    it('runs the agent with headless context and returns the digest payload', async () => {
      const result = await activity.generate('org-1');

      expect(result.skipped).toBeUndefined();
      expect(result.notified).toBe(false);
      expect(result.threadId).toBeDefined();
      expect(result.title).toBe('Weekly agent brief ready');
      expect(result.message).toBe(
        "Your agent has drafted a next-week plan based on last week's performance."
      );
      expect(mockGenerate).toHaveBeenCalledTimes(1);

      const [prompt, options] = mockGenerate.mock.calls[0];
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('read-only');
      expect(prompt).toContain('analyticsOverview');
      expect(prompt).toContain('recommendations');
      expect(prompt).toContain('commentsInbox');
      expect(prompt).toContain('bestTime');

      expect(options.memory.resource).toBe('org-1');
      expect(options.memory.thread).toBe(result.threadId);
      expect(options.maxSteps).toBe(10);
      expect(telemetryService.startSpan).toHaveBeenCalledWith(
        'agent.digest.generate',
        expect.any(Function),
        { 'ai.scope': 'agent' },
      );

      const requestContext = options.requestContext;
      expect(JSON.parse(requestContext.get('organization'))).toEqual({
        id: 'org-1',
        name: 'Test Org',
      });
      expect(JSON.parse(requestContext.get('user'))).toEqual({ id: 'system' });
      expect(requestContext.get('ui')).toBe('false');
      expect(JSON.parse(requestContext.get('access'))).toEqual({
        mode: 'headless',
      });

      // generate never notifies — that is a separate step.
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('returns a non-fatal timeout skip when generation does not finish in time', async () => {
      (activity as any)._digestTimeoutMs = 50;
      vi.mocked(mockGenerate).mockImplementation(() => new Promise(() => {}));

      const result = await activity.generate('org-1');

      expect(result.skipped).toBe(true);
      expect(result.reason).toBe('timeout');
      expect(result.notified).toBe(false);
    });
  });

  describe('notify', () => {
    it('notifies with the thread link and does not regenerate', async () => {
      const result = await activity.notify('org-1', {
        threadId: 'thread-7',
        notified: false,
        title: 'Weekly agent brief ready',
        message:
          "Your agent has drafted a next-week plan based on last week's performance.",
      });

      expect(result.notified).toBe(true);
      expect(result.threadId).toBe('thread-7');
      expect(mockGenerate).not.toHaveBeenCalled();

      expect(notificationService.notify).toHaveBeenCalledWith({
        orgId: 'org-1',
        category: 'agent',
        title: 'Weekly agent brief ready',
        message:
          "Your agent has drafted a next-week plan based on last week's performance.",
        link: '/agents/thread-7',
      });
    });

    it('stays non-fatal but reports the failure honestly when notify throws', async () => {
      vi.mocked(notificationService.notify).mockRejectedValueOnce(
        new Error('smtp down')
      );

      const result = await activity.notify('org-1', {
        threadId: 'thread-7',
        notified: false,
        title: 'Weekly agent brief ready',
        message: 'msg',
      });

      // 4.2: catch is non-fatal (no throw) but must not masquerade as success.
      expect(result.notified).toBe(false);
      expect(result.error).toBe('smtp down');
      expect(result.threadId).toBe('thread-7');
    });
  });
});
