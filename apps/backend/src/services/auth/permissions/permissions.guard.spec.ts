import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PoliciesGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from './permission.exception.class';

interface MockPermissionsService {
  check: ReturnType<typeof vi.fn>;
}

function buildContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function buildAbility(grants: Array<[AuthorizationActions, Sections]>) {
  return {
    can: (action: AuthorizationActions, section: Sections) =>
      grants.some(([a, s]) => a === action && s === section),
  };
}

describe('PoliciesGuard', () => {
  let reflector: Reflector;
  let permissionsService: MockPermissionsService;
  let guard: PoliciesGuard;

  beforeEach(() => {
    reflector = {
      get: vi.fn(),
    } as unknown as Reflector;
    permissionsService = {
      check: vi.fn(),
    };
    guard = new PoliciesGuard(
      reflector,
      permissionsService as unknown as PermissionsService
    );
  });

  it('allows requests with no @CheckPolicies metadata', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValue(undefined);
    const result = await guard.canActivate(
      buildContext({ path: '/user/foo', org: { id: 'o1', createdAt: new Date() } })
    );
    expect(result).toBe(true);
    expect(permissionsService.check).not.toHaveBeenCalled();
  });

  it('allows when the ability grants the requested policy', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValue([
      [AuthorizationActions.Read, Sections.ADMIN],
    ]);
    permissionsService.check.mockResolvedValue(
      buildAbility([[AuthorizationActions.Read, Sections.ADMIN]])
    );

    const result = await guard.canActivate(
      buildContext({
        path: '/user/oauth-app',
        org: { id: 'o1', createdAt: new Date() },
      })
    );

    expect(result).toBe(true);
  });

  // AUTH-01 acceptance: a non-admin org member must no longer pass a
  // Sections.ADMIN billing policy check. The unconditional grant was removed
  // from PermissionsService.check, so the ability returned for a normal member
  // cannot Read Sections.ADMIN, and PoliciesGuard must throw SubscriptionException
  // (HTTP 402) rather than letting the request through.
  it('throws SubscriptionException (402) for a non-admin member on Sections.ADMIN policy', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValue([
      [AuthorizationActions.Read, Sections.ADMIN],
    ]);
    permissionsService.check.mockResolvedValue(
      buildAbility([
        [AuthorizationActions.Create, Sections.POSTS_PER_MONTH],
        [AuthorizationActions.Read, Sections.CHANNEL],
      ])
    );

    await expect(
      guard.canActivate(
        buildContext({
          path: '/user/oauth-app',
          org: { id: 'o1', createdAt: new Date() },
        })
      )
    ).rejects.toThrow(SubscriptionException);

    const checkCall = permissionsService.check.mock.calls[0];
    expect(checkCall[3]).toEqual([[AuthorizationActions.Read, Sections.ADMIN]]);
  });

  it('does not throw ForbiddenException for a failed policy check', async () => {
    (reflector.get as ReturnType<typeof vi.fn>).mockReturnValue([
      [AuthorizationActions.Read, Sections.ADMIN],
    ]);
    permissionsService.check.mockResolvedValue(buildAbility([]));

    let thrown: Error | undefined;
    try {
      await guard.canActivate(
        buildContext({
          path: '/user/oauth-app',
          org: { id: 'o1', createdAt: new Date() },
        })
      );
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeInstanceOf(SubscriptionException);
    expect(thrown).not.toBeInstanceOf(ForbiddenException);
  });
});
