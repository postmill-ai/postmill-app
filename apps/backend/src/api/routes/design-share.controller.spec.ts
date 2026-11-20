import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DesignShareController } from './design-share.controller';
import { CHECK_POLICIES_KEY } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { REQUIRE_PERMISSION_KEY } from '@postmill-ai/backend/services/auth/rbac/require-permission.decorator';
import {
  AuthorizationActions,
  Sections,
} from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';

describe('DesignShareController', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: DesignShareController;

  beforeEach(() => {
    service = {
      getShare: vi.fn(),
      saveShare: vi.fn(),
      disableShare: vi.fn(),
      getTeamPreview: vi.fn(),
      renderTeamPreview: vi.fn().mockResolvedValue(Buffer.from('png')),
    };
    controller = new DesignShareController(service as any);
  });

  it.each(['getShare', 'saveShare', 'disableShare'] as const)(
    'requires media:update for %s',
    (method) => {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignShareController.prototype[method]))
        .toEqual({ resource: 'media', action: 'update' });
      expect(Reflect.getMetadata(CHECK_POLICIES_KEY, DesignShareController.prototype[method]))
        .toEqual([[AuthorizationActions.Update, Sections.MEDIA]]);
    },
  );

  it.each(['getTeamPreview', 'renderTeamPreview'] as const)(
    'requires media:read for %s',
    (method) => {
      expect(Reflect.getMetadata(REQUIRE_PERMISSION_KEY, DesignShareController.prototype[method]))
        .toEqual({ resource: 'media', action: 'read' });
    },
  );

  it('delegates share management with organization scope', async () => {
    await controller.getShare({ id: 'org-1' } as any, 'design-1');
    await controller.saveShare({ id: 'org-1' } as any, 'design-1', { enabled: true });
    await controller.disableShare({ id: 'org-1' } as any, 'design-1');
    expect(service.getShare).toHaveBeenCalledWith('org-1', 'design-1');
    expect(service.saveShare).toHaveBeenCalledWith('org-1', 'design-1', { enabled: true });
    expect(service.disableShare).toHaveBeenCalledWith('org-1', 'design-1');
  });

  it('returns team preview PNGs as private and non-cacheable', async () => {
    const res = { setHeader: vi.fn(), end: vi.fn() };
    await controller.renderTeamPreview({ id: 'org-1' } as any, 'design-1', 1, 2, res as any);
    expect(service.renderTeamPreview).toHaveBeenCalledWith('org-1', 'design-1', 1, 2);
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('png'));
  });
});
