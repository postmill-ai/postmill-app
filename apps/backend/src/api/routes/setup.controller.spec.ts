import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { SetupController } from './setup.controller';

describe('SetupController', () => {
  let controller: SetupController;
  const completeSetup = vi.fn();
  const mockService = { completeSetup } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SetupController(mockService);
  });

  it('POST /complete delegates to OrganizationService.completeSetup', async () => {
    const organization = { id: 'org-1' } as any;
    completeSetup.mockResolvedValue({ id: 'org-1', setupCompletedAt: new Date() });

    const result = await controller.completeSetup({} as any, organization);

    expect(completeSetup).toHaveBeenCalledWith('org-1');
    expect(result).toEqual({ setupCompleted: true });
  });
});
