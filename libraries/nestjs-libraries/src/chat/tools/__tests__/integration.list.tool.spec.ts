import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { IntegrationListTool } from '../integration.list.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

const org = makeOrganization();
const user = makeUser();

describe('IntegrationListTool (9.3)', () => {
  it('emits type/display/disabled and they survive the outputSchema', async () => {
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        {
          name: 'X Account',
          id: 'int-1',
          disabled: false,
          picture: 'https://example.com/x.png',
          providerIdentifier: 'x',
          profile: 'test-profile',
          type: 'social',
        },
      ]),
    };
    const tool = new IntegrationListTool(integrationService as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output[0]).toMatchObject({
      id: 'int-1',
      type: 'social',
      display: 'test-profile',
      disabled: false,
      platform: 'x',
    });
    expect(result.output[0]).not.toHaveProperty('customer');

    // These fields must be DECLARED on the outputSchema, else validateToolOutput
    // strips them.
    const outputSchema = (tool.run() as any).outputSchema;
    expect(outputSchema.safeParse(result).success).toBe(true);
  });

  it('lists every channel of the org (channels are org-scoped; no group filter)', async () => {
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        { name: 'A', id: 'int-a', disabled: false, picture: '', providerIdentifier: 'x', profile: '', type: 'social' },
        { name: 'B', id: 'int-b', disabled: true, picture: '', providerIdentifier: 'linkedin', profile: '', type: 'social' },
      ]),
    };
    const tool = new IntegrationListTool(integrationService as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output.map((o: any) => o.id)).toEqual(['int-a', 'int-b']);
    expect(result.count).toBe(2);
    expect(integrationService.getIntegrationsList).toHaveBeenCalledWith(org.id);
  });

  it('describes itself in product vocabulary so "how many channels" routes here', () => {
    const description = (tool().run() as any).description as string;
    expect(description).toMatch(/channels/i);
    expect(description).toMatch(/how many channels/i);
    expect(description).not.toMatch(/customer|group/i);
  });
});

const tool = () => new IntegrationListTool({ getIntegrationsList: vi.fn() } as any);
