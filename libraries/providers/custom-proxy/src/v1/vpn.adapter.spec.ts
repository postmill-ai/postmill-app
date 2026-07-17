import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as net from 'net';
import { CustomProxyAdapter } from './vpn.adapter';

vi.mock('net');

function makeSocket() {
  const socket = new EventEmitter() as any;
  socket.destroy = vi.fn();
  return socket;
}

describe('CustomProxyAdapter.healthCheck', () => {
  let adapter: CustomProxyAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new CustomProxyAdapter();
  });

  it('returns not-ok when the config lacks a valid host/port (no socket opened)', async () => {
    const res = await adapter.healthCheck({ host: '', port: 'abc', protocol: 'socks5' });
    expect(res.ok).toBe(false);
    expect(net.createConnection as any).not.toHaveBeenCalled();
  });

  it('returns not-ok when the proxy host/port is unreachable', async () => {
    const socket = makeSocket();
    (net.createConnection as any).mockReturnValue(socket);

    const p = adapter.healthCheck({ host: 'proxy.bad', port: '1080', protocol: 'socks5' });
    socket.emit('error', new Error('ECONNREFUSED'));
    const res = await p;

    expect(res.ok).toBe(false);
    expect(res.error).toContain('proxy.bad:1080');
    expect(net.createConnection as any).toHaveBeenCalledWith({ host: 'proxy.bad', port: 1080 });
    expect(socket.destroy).toHaveBeenCalled();
  });

  it('returns ok when a TCP connection to the proxy succeeds', async () => {
    const socket = makeSocket();
    (net.createConnection as any).mockReturnValue(socket);

    const p = adapter.healthCheck({ host: '203.0.113.5', port: '1080', protocol: 'socks5' });
    socket.emit('connect');
    const res = await p;

    expect(res.ok).toBe(true);
    expect(socket.destroy).toHaveBeenCalled();
  });
});
