import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { CommsOauthController } from './comms-oauth.controller';

const savedFrontendUrl = process.env.FRONTEND_URL;

const makeRes = () => {
  const res: any = {};
  res.redirect = vi.fn((url: string) => {
    res.redirectedTo = url;
    return res;
  });
  res.setHeader = vi.fn(() => res);
  res.send = vi.fn((body: string) => {
    res.body = body;
    return res;
  });
  return res;
};

describe('CommsOauthController', () => {
  let controller: CommsOauthController;
  let configService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FRONTEND_URL = 'https://app.example';
    configService = { handleSlackOAuthCallback: vi.fn().mockResolvedValue(undefined) };
    controller = new CommsOauthController(configService);
  });

  afterAll(() => {
    if (savedFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontendUrl;
  });

  it('redirects to the settings page with an error on user denial or missing params', async () => {
    const res = makeRes();
    await controller.slackCallback(undefined as any, undefined as any, 'access_denied', res);
    expect(res.redirectedTo).toBe('https://app.example/settings/comms?error=access_denied');
    expect(configService.handleSlackOAuthCallback).not.toHaveBeenCalled();

    const res2 = makeRes();
    await controller.slackCallback(undefined as any, 'state-1', undefined as any, res2);
    expect(res2.redirectedTo).toBe(
      'https://app.example/settings/comms?error=missing_code',
    );
  });

  it('redirects with the service error message when the exchange fails', async () => {
    configService.handleSlackOAuthCallback.mockRejectedValue(
      new Error('Invalid or expired state'),
    );
    const res = makeRes();
    await controller.slackCallback('code-1', 'bad-state', undefined as any, res);
    expect(res.redirectedTo).toBe(
      'https://app.example/settings/comms?error=Invalid%20or%20expired%20state',
    );
  });

  it('serves the postMessage close page on success', async () => {
    const res = makeRes();
    await controller.slackCallback('code-1', 'state-1', undefined as any, res);
    expect(configService.handleSlackOAuthCallback).toHaveBeenCalledWith('code-1', 'state-1');
    expect(res.body).toContain('postmill:comms-connected');
    expect(res.body).toContain('"https://app.example"');
    expect(res.body).toContain(
      'https://app.example/settings/comms?connected=slack',
    );
  });
});
