import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRbacGuard } from './org-rbac.guard';
import { RequirePermissionMetadata } from './require-permission.decorator';

interface MockRolesService {
  getEffectivePermissions: ReturnType<typeof vi.fn>;
}

interface MockAuditService {
  record: ReturnType<typeof vi.fn>;
}

const buildContext = (request: Record<string, unknown>): ExecutionContext =>
  ({
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext);

describe('OrgRbacGuard', () => {
  let reflector: Reflector;
  let rolesService: MockRolesService;
  let audit: MockAuditService;
  let guard: OrgRbacGuard;
  let metadata: RequirePermissionMetadata | undefined;

  beforeEach(() => {
    metadata = { resource: 'settings', action: 'read' };
    reflector = {
      getAllAndOverride: vi.fn(() => metadata),
    } as unknown as Reflector;
    rolesService = {
      getEffectivePermissions: vi.fn(),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    guard = new OrgRbacGuard(reflector, rolesService as never, audit as never);
  });

  it('allows routes without @RequirePermission metadata', async () => {
    metadata = undefined;
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1' }, orgId: 'o1' })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('bypasses /api/inngest even when metadata is present', async () => {
    const result = await guard.canActivate(
      buildContext({ path: '/api/inngest' })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated requests', async () => {
    await expect(guard.canActivate(buildContext({}))).rejects.toThrow(
      ForbiddenException
    );
  });

  it('rejects requests without a resolved org', async () => {
    await expect(
      guard.canActivate(buildContext({ user: { id: 'u1' } }))
    ).rejects.toThrow(ForbiddenException);
  });

  it('bypasses for platform super-admin', async () => {
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1', isSuperAdmin: true }, orgId: 'o1' })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  // Regression: AuthMiddleware sets `req.org` (the Organization object), NOT
  // `req.orgId`. The guard must resolve the org id from either shape. Before the
  // fix it only read `req.orgId`, so `req.org`-only requests (i.e. every real
  // cookie-authenticated request) 403'd on EVERY @RequirePermission route — even
  // for super-admins, because the org-id check runs before the super-admin bypass.
  it('resolves the org id from req.org.id (AuthMiddleware shape) for super-admin', async () => {
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1', isSuperAdmin: true }, org: { id: 'o1' } })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).not.toHaveBeenCalled();
  });

  it('resolves the org id from req.org.id when checking a member permission', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'admin',
      permissions: ['settings:read'],
    });
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1' }, org: { id: 'o1' } })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).toHaveBeenCalledWith('o1', 'u1');
  });

  it('prefers req.orgId over req.org.id when both are present', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'admin',
      permissions: ['settings:read'],
    });
    await guard.canActivate(
      buildContext({
        user: { id: 'u1' },
        orgId: 'direct',
        org: { id: 'fromObject' },
      })
    );
    expect(rolesService.getEffectivePermissions).toHaveBeenCalledWith(
      'direct',
      'u1'
    );
  });

  it('403s when the user is not a member (null resolution)', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue(null);
    await expect(
      guard.canActivate(buildContext({ user: { id: 'u1' }, orgId: 'o1' }))
    ).rejects.toThrow('Not a member of this organization');
  });

  it('allows when the role carries the exact permission', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'admin',
      permissions: ['settings:read'],
    });
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1' }, orgId: 'o1' })
    );
    expect(result).toBe(true);
    expect(rolesService.getEffectivePermissions).toHaveBeenCalledWith(
      'o1',
      'u1'
    );
  });

  it('allows when the role carries manage on the resource (manage implies all)', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'owner',
      permissions: ['settings:manage'],
    });
    const result = await guard.canActivate(
      buildContext({ user: { id: 'u1' }, orgId: 'o1' })
    );
    expect(result).toBe(true);
  });

  it('403s when the role lacks the permission', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'member',
      permissions: ['posts:read'],
    });
    await expect(
      guard.canActivate(buildContext({ user: { id: 'u1' }, orgId: 'o1' }))
    ).rejects.toThrow('Insufficient permissions');
  });

  // F2(a): an insufficient-permission 403 must emit a non-fatal `rbac.denied` audit
  // event carrying the attempted (resource, action) and no secret.
  it('records a rbac.denied audit event on insufficient permissions', async () => {
    metadata = { resource: 'posts', action: 'create' };
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'member',
      permissions: ['posts:read'],
    });
    await expect(
      guard.canActivate(buildContext({ user: { id: 'u1' }, orgId: 'o1' }))
    ).rejects.toThrow('Insufficient permissions');

    expect(audit.record).toHaveBeenCalledTimes(1);
    const arg = audit.record.mock.calls[0][0];
    expect(arg.action).toBe('rbac.denied');
    expect(arg.resource).toBe('posts:create');
    expect(arg.orgId).toBe('o1');
    expect(arg.userId).toBe('u1');
    expect(JSON.stringify(arg)).not.toMatch(/secret|password|token/i);
  });

  it('does not record an audit event when permission is granted', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'admin',
      permissions: ['settings:read'],
    });
    await guard.canActivate(buildContext({ user: { id: 'u1' }, orgId: 'o1' }));
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('stays non-fatal if the audit write rejects', async () => {
    audit.record.mockRejectedValue(new Error('audit down'));
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'member',
      permissions: ['posts:read'],
    });
    await expect(
      guard.canActivate(buildContext({ user: { id: 'u1' }, orgId: 'o1' }))
    ).rejects.toThrow('Insufficient permissions');
  });

  it('caches resolution per (user, org) on the request', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue({
      role: 'admin',
      permissions: ['settings:read'],
    });
    const request = { user: { id: 'u1' }, orgId: 'o1' };
    await guard.canActivate(buildContext(request));
    await guard.canActivate(buildContext(request));
    expect(rolesService.getEffectivePermissions).toHaveBeenCalledTimes(1);
  });

  it('caches null resolutions too (no repeat lookup for non-members)', async () => {
    rolesService.getEffectivePermissions.mockResolvedValue(null);
    const request = { user: { id: 'u1' }, orgId: 'o1' };
    await expect(guard.canActivate(buildContext(request))).rejects.toThrow();
    await expect(guard.canActivate(buildContext(request))).rejects.toThrow();
    expect(rolesService.getEffectivePermissions).toHaveBeenCalledTimes(1);
  });
});
