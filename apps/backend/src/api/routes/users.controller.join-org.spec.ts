import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

const invite = {
  id: 'invite-1',
  orgId: 'org-1',
  role: 'ADMIN' as const,
  roleId: 'role-1',
};

const createController = (cookie: typeof invite | false, addedOrg: unknown = false) => {
  const auth = { getOrgFromCookie: vi.fn().mockReturnValue(cookie) };
  const organizations = { addUserToOrg: vi.fn().mockResolvedValue(addedOrg) };
  const controller = new UsersController(
    {} as any,
    {} as any,
    auth as any,
    organizations as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { controller, auth, organizations };
};

describe('UsersController joinOrg', () => {
  it('returns a serializable null id for an invalid or expired invite', async () => {
    const { controller, organizations } = createController(false);

    const result = await controller.joinOrg({ id: 'user-1' } as any, 'invalid');

    expect(result).toEqual({ id: null });
    expect(() => JSON.stringify(result)).not.toThrow();
    expect(organizations.addUserToOrg).not.toHaveBeenCalled();
  });

  it('returns a null id when the invite cannot add another membership', async () => {
    const { controller } = createController(invite, false);

    await expect(
      controller.joinOrg({ id: 'user-1' } as any, 'signed-invite')
    ).resolves.toEqual({ id: null });
  });

  it('joins the signed organization and returns its id', async () => {
    const { controller, auth, organizations } = createController(invite, {
      organizationId: 'org-1',
    });

    await expect(
      controller.joinOrg({ id: 'user-1' } as any, 'signed-invite')
    ).resolves.toEqual({ id: 'org-1' });
    expect(auth.getOrgFromCookie).toHaveBeenCalledWith('signed-invite');
    expect(organizations.addUserToOrg).toHaveBeenCalledWith(
      'user-1',
      'invite-1',
      'org-1',
      'ADMIN',
      'role-1'
    );
  });
});
