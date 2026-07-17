import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { IntegrationSchedulePostTool } from '../integration.schedule.post';
import { executeTool, makeUser, makeOrganization } from './tool-test.harness';

const user = makeUser();

const baseInput = {
  socialPost: [
    {
      integrationId: 'int-1',
      isPremium: false,
      date: '2026-07-05T12:00:00Z',
      shortLink: false,
      type: 'schedule',
      postsAndComments: [{ content: '<p>Hello</p>', attachments: [] }],
      settings: [],
    },
  ],
};

function makeServices(overrides: {
  posts?: Record<string, any>;
  integration?: Record<string, any>;
  guardrail?: Record<string, any>;
  subscription?: Record<string, any>;
} = {}) {
  const postsService = {
    validatePosts: vi.fn().mockResolvedValue([
      { name: 'Int One', emptyContent: false, valid: true, errors: true, tooLong: false },
    ]),
    createPost: vi.fn().mockResolvedValue([{ postId: 'p-1', integration: 'int-1' }]),
    countPostsFromDay: vi.fn().mockResolvedValue(0),
    ...overrides.posts,
  };
  const integrationService = {
    getIntegrationById: vi.fn().mockResolvedValue({
      id: 'int-1',
      name: 'Int One',
      providerIdentifier: 'x',
      disabled: false,
      refreshNeeded: false,
    }),
    ...overrides.integration,
  };
  const guardrailService = {
    checkOutput: vi.fn().mockImplementation(async (c: string) => c),
    ...overrides.guardrail,
  };
  const subscriptionService = {
    getSubscriptionByOrganizationId: vi
      .fn()
      .mockResolvedValue({ subscriptionTier: 'STARTER' }),
    getSubscription: vi.fn().mockResolvedValue({ createdAt: new Date() }),
    ...overrides.subscription,
  };
  return { postsService, integrationService, guardrailService, subscriptionService };
}

describe('IntegrationSchedulePostTool', () => {
  const originalStripe = process.env.STRIPE_PUBLISHABLE_KEY;
  afterEach(() => {
    if (originalStripe === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = originalStripe;
  });

  it('throws via parseOrg when the org context has no id (fail-closed) and never touches any service', async () => {
    const { postsService, integrationService, guardrailService, subscriptionService } =
      makeServices();
    const tool = new IntegrationSchedulePostTool(
      postsService as any,
      integrationService as any,
      guardrailService as any,
      subscriptionService as any
    );

    await expect(
      executeTool(tool, {
        inputData: baseInput,
        organization: { name: 'No Id Org' }, // missing id
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('Organization context missing id');

    expect(guardrailService.checkOutput).not.toHaveBeenCalled();
    expect(integrationService.getIntegrationById).not.toHaveBeenCalled();
    expect(postsService.validatePosts).not.toHaveBeenCalled();
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('1.3 — returns a quota error and never creates when the org is at its POSTS_PER_MONTH cap', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';
    const { postsService, integrationService, guardrailService, subscriptionService } =
      makeServices({
        posts: { countPostsFromDay: vi.fn().mockResolvedValue(400) }, // STANDARD limit = 400
      });
    const tool = new IntegrationSchedulePostTool(
      postsService as any,
      integrationService as any,
      guardrailService as any,
      subscriptionService as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: makeOrganization(),
      user,
      access: { mode: 'user' },
    });

    // The tool surfaces the error to the model (schema wraps a bare `{ errors }`
    // return, but the quota text is always present in the payload).
    expect(JSON.stringify(result)).toMatch(/Monthly post limit/i);
    expect(postsService.createPost).not.toHaveBeenCalled();
  });

  it('1.3 — allows creation when under the cap', async () => {
    process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_123';
    const { postsService, integrationService, guardrailService, subscriptionService } =
      makeServices({
        posts: {
          countPostsFromDay: vi.fn().mockResolvedValue(5),
          validatePosts: vi.fn().mockResolvedValue([
            { name: 'Int One', emptyContent: false, valid: true, errors: true, tooLong: false },
          ]),
          createPost: vi.fn().mockResolvedValue([{ postId: 'p-1', integration: 'int-1' }]),
        },
      });
    const tool = new IntegrationSchedulePostTool(
      postsService as any,
      integrationService as any,
      guardrailService as any,
      subscriptionService as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: makeOrganization(),
      user,
      access: { mode: 'user' },
    });

    expect(result.output).toBeTruthy();
    expect(postsService.createPost).toHaveBeenCalledTimes(1);
  });

  it('4.2d — refuses to schedule onto a disabled/refresh-needed channel', async () => {
    const { postsService, integrationService, guardrailService, subscriptionService } =
      makeServices({
        integration: {
          getIntegrationById: vi.fn().mockResolvedValue({
            id: 'int-1',
            name: 'Int One',
            providerIdentifier: 'x',
            disabled: false,
            refreshNeeded: true,
          }),
        },
      });
    const tool = new IntegrationSchedulePostTool(
      postsService as any,
      integrationService as any,
      guardrailService as any,
      subscriptionService as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: makeOrganization(),
      user,
      access: { mode: 'user' },
    });

    expect(JSON.stringify(result)).toMatch(/disconnected or needs reauthentication/i);
    expect(postsService.createPost).not.toHaveBeenCalled();
  });
});
