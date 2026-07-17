import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { PushNotificationService } from './push-notification.service';

const mockSend = vi.fn().mockResolvedValue('msg-1');
const mockSendEachForMulticast = vi.fn().mockResolvedValue({
  responses: [{ success: true }],
});
const mockGetMessaging = vi.fn().mockReturnValue({
  send: mockSend,
  sendEachForMulticast: mockSendEachForMulticast,
});
const mockInitializeApp = vi.fn().mockReturnValue({ name: '[DEFAULT]' });
const mockGetApps = vi.fn().mockReturnValue([]);

vi.mock('firebase-admin/app', () => ({
  initializeApp: mockInitializeApp,
  cert: vi.fn((c) => c),
  getApps: mockGetApps,
}));

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: mockGetMessaging,
}));

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let pushTokens: any;

  beforeEach(() => {
    pushTokens = {
      model: {
        pushToken: {
          findUnique: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue(undefined),
          update: vi.fn().mockResolvedValue(undefined),
          upsert: vi.fn().mockResolvedValue(undefined),
          findMany: vi.fn().mockResolvedValue([]),
          updateMany: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
    service = new PushNotificationService(pushTokens);
    vi.clearAllMocks();
  });

  it('registers a token', async () => {
    await service.registerToken('user-1', 'token-1', 'ios', 'Phone');
    expect(pushTokens.model.pushToken.findUnique).toHaveBeenCalledWith({
      where: { token: 'token-1' },
    });
    expect(pushTokens.model.pushToken.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        token: 'token-1',
        platform: 'ios',
        deviceName: 'Phone',
        active: true,
      }),
    });
    expect(pushTokens.model.pushToken.update).not.toHaveBeenCalled();
  });

  it('does not reassign a token already registered to a different user', async () => {
    pushTokens.model.pushToken.findUnique.mockResolvedValue({
      userId: 'user-1',
      token: 'token-1',
    });

    await service.registerToken('user-2', 'token-1', 'android', 'Other Phone');

    expect(pushTokens.model.pushToken.findUnique).toHaveBeenCalledWith({
      where: { token: 'token-1' },
    });
    expect(pushTokens.model.pushToken.create).not.toHaveBeenCalled();
    expect(pushTokens.model.pushToken.update).not.toHaveBeenCalled();
    expect(pushTokens.model.pushToken.upsert).not.toHaveBeenCalled();
  });

  it('recovers from a race when the same user wins the create', async () => {
    const raceError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`token`)',
      { code: 'P2002', clientVersion: 'x' }
    );
    pushTokens.model.pushToken.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', token: 'token-1' });
    pushTokens.model.pushToken.create.mockRejectedValue(raceError);

    await service.registerToken('user-1', 'token-1', 'ios', 'Phone');

    expect(pushTokens.model.pushToken.update).toHaveBeenCalledWith({
      where: { token: 'token-1' },
      data: expect.objectContaining({
        platform: 'ios',
        active: true,
      }),
    });
  });

  it('does not reassign when a race creates the token for a different user', async () => {
    const raceError = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`token`)',
      { code: 'P2002', clientVersion: 'x' }
    );
    pushTokens.model.pushToken.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ userId: 'user-1', token: 'token-1' });
    pushTokens.model.pushToken.create.mockRejectedValue(raceError);

    await service.registerToken('user-2', 'token-1', 'android', 'Other Phone');

    expect(pushTokens.model.pushToken.update).not.toHaveBeenCalled();
    expect(pushTokens.model.pushToken.upsert).not.toHaveBeenCalled();
  });

  it('skips send when FCM is not configured', async () => {
    delete process.env.FCM_PROJECT_ID;
    delete process.env.FCM_CLIENT_EMAIL;
    delete process.env.FCM_PRIVATE_KEY;

    await service.sendPushNotification('user-1', { title: 'T', body: 'B' });

    expect(mockInitializeApp).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('sends a single message when one token exists', async () => {
    process.env.FCM_PROJECT_ID = 'proj';
    process.env.FCM_CLIENT_EMAIL = 'email@example.com';
    process.env.FCM_PRIVATE_KEY = 'key';

    pushTokens.model.pushToken.findMany.mockResolvedValue([
      { token: 'token-1' },
    ]);

    await service.sendPushNotification('user-1', { title: 'T', body: 'B' });

    expect(mockInitializeApp).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-1',
        notification: { title: 'T', body: 'B' },
      })
    );
  });

  it('sends multicast and deactivates invalid tokens', async () => {
    process.env.FCM_PROJECT_ID = 'proj';
    process.env.FCM_CLIENT_EMAIL = 'email@example.com';
    process.env.FCM_PRIVATE_KEY = 'key';

    pushTokens.model.pushToken.findMany.mockResolvedValue([
      { token: 'token-1' },
      { token: 'token-2' },
    ]);
    mockSendEachForMulticast.mockResolvedValue({
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
      ],
    });

    await service.sendPushNotification('user-1', { title: 'T', body: 'B' });

    expect(mockSendEachForMulticast).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: ['token-1', 'token-2'],
        notification: { title: 'T', body: 'B' },
      })
    );
    expect(pushTokens.model.pushToken.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['token-2'] } },
      data: { active: false },
    });
  });

  it('deactivates a token', async () => {
    await service.deactivateToken('token-1');
    expect(pushTokens.model.pushToken.updateMany).toHaveBeenCalledWith({
      where: { token: 'token-1' },
      data: { active: false },
    });
  });
});
