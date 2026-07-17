import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTriggerTool } from '../integration.trigger.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

// Neutralize the 10s refresh-wait sleep so the bounded-retry test is instant.
vi.mock('@gitroom/helpers/utils/timer', () => ({
  timer: vi.fn().mockResolvedValue(undefined),
}));

const org = makeOrganization();
const user = makeUser();

const baseInput = {
  integrationId: 'int-1',
  methodName: 'search',
  dataSchema: [{ key: 'q', value: 'hello' }],
};

describe('IntegrationTriggerTool (9.3)', () => {
  it('bounds the refresh-retry loop and returns a structured error (does not spin forever)', async () => {
    const integration = {
      providerIdentifier: 'x',
      token: 'token-1',
      internalId: 'internal-1',
    };
    const search = vi.fn().mockRejectedValue(new RefreshToken());
    const integrationProvider = { identifier: 'x', search, refreshWait: true };
    const integrationService = {
      getIntegrationById: vi.fn().mockResolvedValue(integration),
      disconnectChannel: vi.fn(),
    };
    const integrationManager = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue(integrationProvider),
      getAllTools: vi.fn().mockReturnValue({
        x: [{ methodName: 'search', description: 'Search', dataSchema: [] }],
      }),
    };
    // Always succeeds → without a bound the loop would retry endlessly.
    const refreshIntegrationService = {
      refresh: vi.fn().mockResolvedValue({ accessToken: 'fresh-token' }),
    };
    const tool = new IntegrationTriggerTool(
      integrationManager as any,
      integrationService as any,
      refreshIntegrationService as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: org,
      user,
      access: { mode: 'user' },
    });

    // Exactly 2 provider calls (initial + one retry), then bail — not infinite.
    expect(search).toHaveBeenCalledTimes(2);
    expect(result.output).toMatch(/kept expiring/i);
  });

  it('returns a structured error when a refresh yields no accessToken', async () => {
    const integration = { providerIdentifier: 'x', token: 't', internalId: 'i' };
    const integrationProvider = {
      identifier: 'x',
      search: vi.fn().mockRejectedValue(new RefreshToken()),
      refreshWait: false,
    };
    const integrationService = {
      getIntegrationById: vi.fn().mockResolvedValue(integration),
      disconnectChannel: vi.fn(),
    };
    const integrationManager = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue(integrationProvider),
      getAllTools: vi
        .fn()
        .mockReturnValue({ x: [{ methodName: 'search', dataSchema: [] }] }),
    };
    // Truthy data but no accessToken → the old empty `else {}` swallowed this.
    const refreshIntegrationService = {
      refresh: vi.fn().mockResolvedValue({ accessToken: undefined }),
    };
    const tool = new IntegrationTriggerTool(
      integrationManager as any,
      integrationService as any,
      refreshIntegrationService as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output).toMatch(/did not return a new access token/i);
    expect(result.output).not.toMatch(/unexpected error/i);
  });

  it('throws via parseOrg when the org context has no id (fail-closed) and never queries an integration', async () => {
    const integrationService = { getIntegrationById: vi.fn() };
    const integrationManager = {
      getSocialIntegrationUnchecked: vi.fn(),
      getAllTools: vi.fn(),
    };
    const tool = new IntegrationTriggerTool(
      integrationManager as any,
      integrationService as any,
      { refresh: vi.fn() } as any
    );

    await expect(
      executeTool(tool, {
        inputData: baseInput,
        organization: { name: 'No Id Org' }, // missing id
        user,
        access: { mode: 'user' },
      })
    ).rejects.toThrow('Organization context missing id');

    expect(integrationService.getIntegrationById).not.toHaveBeenCalled();
  });

  it('lets a NON-array successful provider payload survive the outputSchema', async () => {
    const integration = { providerIdentifier: 'x', token: 't', internalId: 'i' };
    // A plain object payload — the old `z.array(...)` schema would reject this.
    const payload = { profile: { id: 'u-1', handle: '@bob' }, followers: 42 };
    const integrationProvider = {
      identifier: 'x',
      search: vi.fn().mockResolvedValue(payload),
    };
    const integrationService = {
      getIntegrationById: vi.fn().mockResolvedValue(integration),
    };
    const integrationManager = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue(integrationProvider),
      getAllTools: vi
        .fn()
        .mockReturnValue({ x: [{ methodName: 'search', dataSchema: [] }] }),
    };
    const tool = new IntegrationTriggerTool(
      integrationManager as any,
      integrationService as any,
      { refresh: vi.fn() } as any
    );

    const result = await executeTool(tool, {
      inputData: baseInput,
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output).toEqual(payload);

    // The declared outputSchema must ACCEPT the non-array success (mastra's
    // validateToolOutput would otherwise replace it with a validation error).
    const outputSchema = (tool.run() as any).outputSchema;
    expect(outputSchema.safeParse(result).success).toBe(true);
  });
});
