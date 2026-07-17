import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { IntegrationListTool } from '../integration.list.tool';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

const org = makeOrganization();
const user = makeUser();

describe('IntegrationListTool (9.3)', () => {
  it('emits customer/type/display/disabled and they survive the outputSchema', async () => {
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
          customer: { id: 'cust-1', name: 'Acme' },
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
      customer: { id: 'cust-1', name: 'Acme' },
    });

    // These fields must be DECLARED on the outputSchema, else validateToolOutput
    // strips them (the group `.filter` relies on `customer`).
    const outputSchema = (tool.run() as any).outputSchema;
    expect(outputSchema.safeParse(result).success).toBe(true);
  });

  it('filters by group id via the customer relation', async () => {
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        {
          name: 'A',
          id: 'int-a',
          disabled: false,
          picture: '',
          providerIdentifier: 'x',
          profile: '',
          type: 'social',
          customer: { id: 'cust-1', name: 'Acme' },
        },
        {
          name: 'B',
          id: 'int-b',
          disabled: false,
          picture: '',
          providerIdentifier: 'x',
          profile: '',
          type: 'social',
          customer: { id: 'cust-2', name: 'Other' },
        },
      ]),
    };
    const tool = new IntegrationListTool(integrationService as any);

    const result = await executeTool(tool, {
      inputData: { group: 'cust-1' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result.output).toHaveLength(1);
    expect(result.output[0].id).toBe('int-a');
  });
});
