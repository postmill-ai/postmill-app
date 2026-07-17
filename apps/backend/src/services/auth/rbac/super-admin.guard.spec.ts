import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { SuperAdminGuard } from './super-admin.guard';

function ctx(user: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

describe('SuperAdminGuard', () => {
  const guard = new SuperAdminGuard();

  it('allows a super-admin request', () => {
    expect(guard.canActivate(ctx({ id: 'u1', isSuperAdmin: true }))).toBe(true);
  });

  it('throws ForbiddenException for a non-super-admin user', () => {
    expect(() => guard.canActivate(ctx({ id: 'u2', isSuperAdmin: false }))).toThrow(
      ForbiddenException,
    );
  });

  it('throws ForbiddenException when there is no user on the request', () => {
    expect(() => guard.canActivate(ctx(undefined))).toThrow(ForbiddenException);
  });
});
