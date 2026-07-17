import { describe, it, expect, afterEach } from 'vitest';
import { getPodmanRenderConfig, getRenderTimeoutMs } from './render-config';

describe('render-config (2.3 network isolation)', () => {
  afterEach(() => {
    delete process.env.VIDEO_RENDER_NETWORK;
    delete process.env.VIDEO_RENDER_TIMEOUT_MS;
  });

  it('defaults the Podman render network to an isolated bridge, never host', () => {
    delete process.env.VIDEO_RENDER_NETWORK;
    const cfg = getPodmanRenderConfig();
    expect(cfg.network).toBe('bridge');
    expect(cfg.network).not.toBe('host');
  });

  it('still honours an explicit VIDEO_RENDER_NETWORK override (incl. opt-in host)', () => {
    process.env.VIDEO_RENDER_NETWORK = 'host';
    expect(getPodmanRenderConfig().network).toBe('host');

    process.env.VIDEO_RENDER_NETWORK = 'none';
    expect(getPodmanRenderConfig().network).toBe('none');
  });

  it('exposes a wall-clock render timeout (default 120s, env-tunable)', () => {
    delete process.env.VIDEO_RENDER_TIMEOUT_MS;
    expect(getRenderTimeoutMs()).toBe(120000);
    process.env.VIDEO_RENDER_TIMEOUT_MS = '5000';
    expect(getRenderTimeoutMs()).toBe(5000);
  });
});
