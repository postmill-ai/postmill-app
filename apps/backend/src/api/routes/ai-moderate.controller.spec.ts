import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const mockCheckInput = vi.fn(async (text: string) => text);
const mockCheckOutput = vi.fn(async (text: string) => text);

vi.mock('@gitroom/nestjs-libraries/ai/governance/guardrail.service', () => ({
  GuardrailService: class {
    checkInput = mockCheckInput;
    checkOutput = mockCheckOutput;
  },
}));

vi.mock('@gitroom/nestjs-libraries/ai/governance/errors', () => ({
  GuardrailViolation: class GuardrailViolation extends Error {
    constructor(message: string) {
      super(message);
    }
  },
}));

import { AiModerateController } from './ai-moderate.controller';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

describe('AiModerateController', () => {
  let controller: AiModerateController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new AiModerateController(new (GuardrailService as any)());
  });

  it('has no CheckPolicies gate (AI moderation is unlimited under BYOK)', () => {
    const policies = Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      AiModerateController.prototype.moderate,
    );

    expect(policies).toBeUndefined();
  });

  it('uses authenticated request org and ignores body org spoofing', async () => {
    await controller.moderate(
      { content: 'hello', direction: 'input', orgId: 'spoofed-org' } as any,
      { org: { id: 'auth-org' } } as any,
    );

    expect(mockCheckInput).toHaveBeenCalledWith('hello', { orgId: 'auth-org' });
  });

  it('returns a blocked moderation response for guardrail violations', async () => {
    mockCheckOutput.mockRejectedValueOnce(
      new GuardrailViolation('blocked', 'content-policy', 'block'),
    );

    const result = await controller.moderate(
      { content: 'blocked content', direction: 'output' } as any,
      { org: { id: 'org-1' } } as any,
    );

    expect(result).toEqual({ passed: false, warnings: ['blocked'] });
  });
});
