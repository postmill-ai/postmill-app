import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Response, Request } from 'express';
import { PublicController } from './public.controller';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { MediaStreamService } from '@gitroom/nestjs-libraries/media/stream/media-stream.service';
import { AgentGraphInsertService } from '@gitroom/nestjs-libraries/agent/agent.graph.insert.service';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';

describe('PublicController', () => {
  let controller: PublicController;
  let subscriptionService: Partial<SubscriptionService>;
  let mediaStreamService: Partial<MediaStreamService>;
  let agentGraphInsertService: Partial<AgentGraphInsertService>;
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

    agentGraphInsertService = {
      newPost: vi.fn().mockResolvedValue({ id: 'agent-post-1' }),
    };

    trackService = {
      track: vi.fn().mockResolvedValue(undefined),
    };

    controller = new PublicController(
      trackService as TrackService,
      agentGraphInsertService as AgentGraphInsertService,
      subscriptionService as SubscriptionService,
      mediaStreamService as MediaStreamService
    );
  });

  describe('createAgent', () => {
    it('returns the created agent post when the API key matches', async () => {
      process.env.AGENT_API_KEY = 'secret-agent-key';
      const body = { apiKey: 'secret-agent-key', text: 'hello world' };

      const result = await controller.createAgent(body as any);

      expect(agentGraphInsertService.newPost).toHaveBeenCalledWith('hello world');
      expect(result).toEqual({ id: 'agent-post-1' });
    });

    it('throws UnauthorizedException when the API key is missing', async () => {
      process.env.AGENT_API_KEY = 'secret-agent-key';
      const body = { apiKey: 'wrong-key', text: 'hello world' };

      await expect(controller.createAgent(body as any)).rejects.toThrow(
        'Unauthorized'
      );
    });
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
