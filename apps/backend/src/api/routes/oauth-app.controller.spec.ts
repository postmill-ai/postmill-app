import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { OAuthAppController } from './oauth-app.controller';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';

const mockOAuthService = {
  getApp: vi.fn(),
  createApp: vi.fn(),
  updateApp: vi.fn(),
  deleteApp: vi.fn(),
  rotateSecret: vi.fn(),
};

function buildGuardContext(user: any, orgId?: string) {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user, orgId, path: '/user/oauth-app' }),
    }),
  } as any;
}

describe('OAuthAppController', () => {
  let controller: OAuthAppController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new OAuthAppController(mockOAuthService as any);
  });

  // AUTH-02b: every route must carry the new oauth_apps:manage RBAC permission.
  describe('@RequirePermission metadata', () => {
    it.each([
      ['getApp', 'GET /'],
      ['createApp', 'POST /'],
      ['updateApp', 'PUT /'],
      ['deleteApp', 'DELETE /'],
      ['rotateSecret', 'POST /rotate-secret'],
    ])('%s (%s) is gated with oauth_apps:manage', (methodName) => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        (controller as any)[methodName]
      );
      expect(metadata).toEqual({ resource: 'oauth_apps', action: 'manage' });
    });
  });

  describe('handler delegation', () => {
    const org = { id: 'org-123' } as any;

    it('getApp delegates to OAuthService.getApp', async () => {
      mockOAuthService.getApp.mockResolvedValue({ id: 'app-1' });
      const result = await controller.getApp(org);
      expect(mockOAuthService.getApp).toHaveBeenCalledWith('org-123');
      expect(result).toEqual({ id: 'app-1' });
    });

    it('createApp delegates to OAuthService.createApp', async () => {
      const dto = { name: 'My App', redirectUrl: 'https://example.com/cb' };
      mockOAuthService.createApp.mockResolvedValue({ id: 'app-2' });
      const result = await controller.createApp(org, dto as any);
      expect(mockOAuthService.createApp).toHaveBeenCalledWith('org-123', dto);
      expect(result).toEqual({ id: 'app-2' });
    });

    it('updateApp delegates to OAuthService.updateApp', async () => {
      const dto = { name: 'Updated' };
      mockOAuthService.updateApp.mockResolvedValue({ id: 'app-3' });
      const result = await controller.updateApp(org, dto as any);
      expect(mockOAuthService.updateApp).toHaveBeenCalledWith('org-123', dto);
      expect(result).toEqual({ id: 'app-3' });
    });

    it('deleteApp delegates to OAuthService.deleteApp', async () => {
      mockOAuthService.deleteApp.mockResolvedValue({ success: true });
      const result = await controller.deleteApp(org);
      expect(mockOAuthService.deleteApp).toHaveBeenCalledWith('org-123');
      expect(result).toEqual({ success: true });
    });

    it('rotateSecret delegates to OAuthService.rotateSecret', async () => {
      mockOAuthService.rotateSecret.mockResolvedValue({ clientSecret: 'secret' });
      const result = await controller.rotateSecret(org);
      expect(mockOAuthService.rotateSecret).toHaveBeenCalledWith('org-123');
      expect(result).toEqual({ clientSecret: 'secret' });
    });
  });

  // AUTH-02c acceptance: a member whose role does not include oauth_apps:manage
  // must be rejected with HTTP 403 before any controller handler runs.
  describe('RBAC enforcement', () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ({
        resource: 'oauth_apps',
        action: 'manage',
      })),
    } as any;

    const audit = { record: vi.fn().mockResolvedValue(undefined) } as any;

    it.each([
      ['getApp', 'GET /'],
      ['createApp', 'POST /'],
      ['updateApp', 'PUT /'],
      ['deleteApp', 'DELETE /'],
      ['rotateSecret', 'POST /rotate-secret'],
    ])(
      'rejects %s (%s) for a member lacking oauth_apps:manage with ForbiddenException',
      async (methodName) => {
        const rolesService = {
          getEffectivePermissions: vi.fn().mockResolvedValue({
            role: 'editor',
            permissions: ['posts:manage', 'media:manage', 'channels:manage'],
          }),
        };
        const guard = new OrgRbacGuard(reflector, rolesService as any, audit);

        await expect(
          guard.canActivate(
            buildGuardContext({ id: 'u-editor' }, 'org-123')
          )
        ).rejects.toThrow(ForbiddenException);
      }
    );

    it('allows a member with oauth_apps:manage', async () => {
      const rolesService = {
        getEffectivePermissions: vi.fn().mockResolvedValue({
          role: 'admin',
          permissions: ['oauth_apps:manage'],
        }),
      };
      const guard = new OrgRbacGuard(reflector, rolesService as any, audit);

      await expect(
        guard.canActivate(
          buildGuardContext({ id: 'u-admin' }, 'org-123')
        )
      ).resolves.toBe(true);
    });
  });
});
