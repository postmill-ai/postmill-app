import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import type { App } from 'firebase-admin/app';
import type { Message, MulticastMessage } from 'firebase-admin/messaging';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);
  private _app: App | null = null;

  constructor(private _pushTokens: PrismaRepository<'pushToken'>) {}

  hasProvider(): boolean {
    return !!(
      process.env.FCM_PROJECT_ID &&
      process.env.FCM_CLIENT_EMAIL &&
      process.env.FCM_PRIVATE_KEY
    );
  }

  private async _getApp(): Promise<App | null> {
    if (this._app) return this._app;
    if (!this.hasProvider()) return null;

    try {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const existing = getApps().find((a) => a.name === '[DEFAULT]');
      if (existing) {
        this._app = existing;
        return this._app;
      }

      this._app = initializeApp({
        credential: cert({
          projectId: process.env.FCM_PROJECT_ID,
          clientEmail: process.env.FCM_CLIENT_EMAIL,
          privateKey: process.env.FCM_PRIVATE_KEY!.replace(/\\n/g, '\n'),
        }),
      });
      return this._app;
    } catch (err) {
      this.logger.error('Failed to initialize Firebase Admin SDK', err);
      return null;
    }
  }

  async registerToken(
    userId: string,
    token: string,
    platform: string,
    deviceName?: string
  ): Promise<void> {
    const existing = await this._pushTokens.model.pushToken.findUnique({
      where: { token },
    });

    if (existing && existing.userId !== userId) {
      this.logger.warn(
        `Push token already registered to a different user (tokenUserId=${existing.userId}, requestedUserId=${userId}). Skipping reassignment.`
      );
      return;
    }

    if (existing) {
      await this._pushTokens.model.pushToken.update({
        where: { token },
        data: {
          platform,
          deviceName: deviceName ?? null,
          active: true,
          lastUsedAt: new Date(),
        },
      });
      return;
    }

    try {
      await this._pushTokens.model.pushToken.create({
        data: {
          userId,
          token,
          platform,
          deviceName: deviceName ?? null,
          active: true,
          lastUsedAt: new Date(),
        },
      });
    } catch (err) {
      // Race: another request inserted the same unique token between our
      // findUnique and create. Re-read the row and apply the same ownership
      // rules rather than surfacing a raw unique-constraint error.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const raced = await this._pushTokens.model.pushToken.findUnique({
          where: { token },
        });

        if (raced && raced.userId === userId) {
          await this._pushTokens.model.pushToken.update({
            where: { token },
            data: {
              platform,
              deviceName: deviceName ?? null,
              active: true,
              lastUsedAt: new Date(),
            },
          });
          return;
        }

        if (raced && raced.userId !== userId) {
          this.logger.warn(
            `Push token already registered to a different user (tokenUserId=${raced.userId}, requestedUserId=${userId}). Skipping reassignment.`
          );
        }
        return;
      }

      throw err;
    }
  }

  async sendPushNotification(
    userId: string,
    payload: PushPayload
  ): Promise<void> {
    const app = await this._getApp();
    if (!app) {
      this.logger.debug('Skipping push — FCM not configured');
      return;
    }

    const tokens = await this._pushTokens.model.pushToken.findMany({
      where: { userId, active: true },
    });

    if (tokens.length === 0) {
      return;
    }

    try {
      const { getMessaging } = await import('firebase-admin/messaging');
      const messaging = getMessaging(app);

      if (tokens.length === 1) {
        const message: Message = {
          token: tokens[0].token,
          notification: { title: payload.title, body: payload.body },
          data: payload.data ? this._stringifyData(payload.data) : undefined,
        };
        await messaging.send(message);
      } else {
        const message: MulticastMessage = {
          tokens: tokens.map((t) => t.token),
          notification: { title: payload.title, body: payload.body },
          data: payload.data ? this._stringifyData(payload.data) : undefined,
        };
        const response = await messaging.sendEachForMulticast(message);
        await this._handleMulticastResponse(response, tokens.map((t) => t.token));
      }
    } catch (err) {
      this.logger.error(`Failed to send push to user ${userId}`, err);
    }
  }

  private async _handleMulticastResponse(
    response: { responses: Array<{ success: boolean; error?: { code: string } }> },
    tokens: string[]
  ): Promise<void> {
    const invalidTokens: string[] = [];
    for (let i = 0; i < response.responses.length; i++) {
      const r = response.responses[i];
      if (!r.success && r.error) {
        const code = r.error.code;
        if (
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/registration-token-not-registered'
        ) {
          invalidTokens.push(tokens[i]);
        }
      }
    }

    if (invalidTokens.length > 0) {
      await this._pushTokens.model.pushToken.updateMany({
        where: { token: { in: invalidTokens } },
        data: { active: false },
      });
    }
  }

  private _stringifyData(data: Record<string, unknown>): Record<string, string> {
    return Object.entries(data).reduce((acc, [key, value]) => {
      acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
      return acc;
    }, {} as Record<string, string>);
  }

  async deactivateToken(token: string): Promise<void> {
    await this._pushTokens.model.pushToken.updateMany({
      where: { token },
      data: { active: false },
    });
  }
}
