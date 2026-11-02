import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersRepository } from './users.repository';

describe('UsersRepository preferred language and owner selection', () => {
  const upsert = vi.fn();
  const findMany = vi.fn();
  let repository: UsersRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new UsersRepository(
      { model: { user: {} } } as any,
      { model: { session: {} } } as any,
      { model: { userProfile: { upsert } } } as any,
      { model: { userOrganization: { findMany } } } as any
    );
  });

  it('upserts only the authenticated user preference', async () => {
    await repository.changePreferredLanguage('user-1', 'fr');
    expect(upsert).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      create: { userId: 'user-1', preferredLanguage: 'fr' },
      update: { preferredLanguage: 'fr' },
    });
  });

  it('selects only active owner memberships for the English campaign', async () => {
    findMany.mockResolvedValue([]);
    await repository.getActiveOwnerMemberships();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          disabled: false,
          roleRef: { key: 'owner' },
          user: { activated: true },
        },
      })
    );
    expect(findMany.mock.calls[0][0].select.user.select).toEqual({
      id: true,
      email: true,
      lastOnline: true,
    });
  });
});
