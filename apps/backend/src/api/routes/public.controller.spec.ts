import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response, Request } from 'express';
import { PublicController } from './public.controller';
import { SubscriptionService } from '@postmill-ai/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MediaStreamService } from '@postmill-ai/nestjs-libraries/media/stream/media-stream.service';
import { TrackService } from '@postmill-ai/nestjs-libraries/track/track.service';
import { TrackEnum } from '@postmill-ai/nestjs-libraries/user/track.enum';

describe('PublicController', () => {
  let controller: PublicController;
  let subscriptionService: Partial<SubscriptionService>;
  let mediaStreamService: Partial<MediaStreamService>;
  let trackService: Partial<TrackService>;

  const makeRes = (): Partial<Response> => ({
    status: vi.fn(function (this: any) { return this; }),
    type: vi.fn(function (this: any) { return this; }),
    send: vi.fn(function (this: any) { return this; }),
    cookie: vi.fn(function (this: any) { return this; }),
    json: vi.fn(function (this: any) { return this; }),
    on: vi.fn(),
  });

  const makeReq = (): Partial<Request> => ({
    cookies: {},
    on: vi.fn(),
  });

  beforeEach(() => {
    vi.restoreAllMocks();

    subscriptionService = {
      modifyFromJwtToken: vi.fn().mockResolvedValue({ success: true }),
    };

    mediaStreamService = {
      streamExternalUrl: vi.fn().mockResolvedValue(undefined),
    };

    trackService = {
      track: vi.fn().mockResolvedValue(undefined),
    };

    controller = new PublicController(
      trackService as TrackService,
      subscriptionService as SubscriptionService,
      mediaStreamService as MediaStreamService
    );
  });

  describe('modifySubscription', () => {
    it('delegates to SubscriptionService.modifyFromJwtToken', async () => {
      const params = 'signed-jwt-token';

      const result = await controller.modifySubscription(params);

      expect(subscriptionService.modifyFromJwtToken).toHaveBeenCalledWith(params);
      expect(result).toEqual({ success: true });
    });
  });

  describe('trackEvent', () => {
    it('tracks the event and returns the tracking cookie', async () => {
      const res = makeRes() as Response;
      const req = makeReq() as Request;
      const body = { tt: TrackEnum.CompleteRegistration, additional: { foo: 'bar' } };

      await controller.trackEvent(res, req, '127.0.0.1', 'Mozilla/5.0', body);

      expect(trackService.track).toHaveBeenCalledWith(
        expect.any(String),
        '127.0.0.1',
        'Mozilla/5.0',
        TrackEnum.CompleteRegistration,
        { foo: 'bar' },
        undefined
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ track: expect.any(String) });
    });
  });

  describe('streamFile', () => {
    it('rejects non-mp4 URLs with 400', async () => {
      const res = makeRes() as Response;
      const req = makeReq() as Request;

      await controller.streamFile({ url: 'https://example.com/video.avi' } as any, res, req);

      expect(mediaStreamService.streamExternalUrl).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.type).toHaveBeenCalledWith('text/plain');
      expect(res.send).toHaveBeenCalledWith('Invalid video URL');
    });

    it('delegates mp4 URLs to MediaStreamService.streamExternalUrl', async () => {
      const res = makeRes() as Response;
      const req = makeReq() as Request;
      const url = 'https://example.com/video.mp4';

      await controller.streamFile({ url } as any, res, req);

      expect(mediaStreamService.streamExternalUrl).toHaveBeenCalledWith(url, req, res);
    });
  });
});
