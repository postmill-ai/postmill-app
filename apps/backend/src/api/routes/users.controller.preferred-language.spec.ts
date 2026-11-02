import { describe, expect, it, vi } from 'vitest';
import { UsersController } from './users.controller';

describe('UsersController preferred language', () => {
  it('updates only the authenticated user', async () => {
    const users = { changePreferredLanguage: vi.fn().mockResolvedValue(undefined) };
    const controller = new UsersController(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      users as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await expect(
      controller.changePreferredLanguage(
        { id: 'user-1' } as any,
        { preferredLanguage: 'de' }
      )
    ).resolves.toEqual({ success: true, preferredLanguage: 'de' });
    expect(users.changePreferredLanguage).toHaveBeenCalledWith('user-1', 'de');
  });
});
