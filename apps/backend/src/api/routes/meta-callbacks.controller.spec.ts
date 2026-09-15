import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { MetaCallbacksController } from './meta-callbacks.controller';

describe('MetaCallbacksController — registration', () => {
  it('is registered as a PUBLIC controller (NOT in authenticatedController): Meta calls it with no session', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.module.ts'), 'utf8');
    const block = source.match(/authenticatedController = \[([\s\S]*?)\];/);
    expect(block, 'authenticatedController array not found').toBeTruthy();
    expect(block![1]).not.toContain('MetaCallbacksController');
    expect(source).toContain('MetaCallbacksController,');
  });

  it('acks with 200 (Meta treats any non-2xx as a failed callback)', () => {
    for (const method of ['deauthorize', 'dataDeletion']) {
      const code = Reflect.getMetadata('__httpCode__', MetaCallbacksController.prototype[method as 'deauthorize']);
      expect(code, method).toBe(200);
    }
  });
});

describe('MetaCallbacksController', () => {
  let controller: MetaCallbacksController;
  let meta: any;
  const req = (bytes: number) => ({ rawBody: Buffer.alloc(bytes), headers: {} }) as any;

  beforeEach(() => {
    meta = {
      parseSignedRequest: vi.fn().mockResolvedValue({
        family: 'facebook',
        source: 'FACEBOOK_APP_SECRET',
        payload: { user_id: 'fbuser-1', issued_at: 1 },
      }),
      deauthorize: vi.fn().mockResolvedValue({ channels: 2 }),
      requestDeletion: vi.fn().mockResolvedValue({
        url: 'https://app.example/integrations/social/meta/data-deletion?code=ABC',
        confirmation_code: 'ABC',
        status: { code: 'ABC', status: 'completed' },
      }),
      deletionStatus: vi.fn().mockResolvedValue({ code: 'ABC', status: 'completed' }),
    };
    controller = new MetaCallbacksController(meta);
  });

  it('deauthorize: verifies, then disconnects the family/user the signature proved', async () => {
    const result = await controller.deauthorize(req(120), { signed_request: 'sig.payload' });
    expect(meta.parseSignedRequest).toHaveBeenCalledWith('sig.payload');
    expect(meta.deauthorize).toHaveBeenCalledWith('facebook', 'fbuser-1');
    expect(result).toEqual({ ok: true, channels: 2 });
  });

  it('data-deletion: returns exactly { url, confirmation_code } as Meta requires', async () => {
    const result = await controller.dataDeletion(req(120), { signed_request: 'sig.payload' });
    expect(meta.requestDeletion).toHaveBeenCalledWith('facebook', 'fbuser-1');
    expect(result).toEqual({
      url: 'https://app.example/integrations/social/meta/data-deletion?code=ABC',
      confirmation_code: 'ABC',
    });
    expect(Object.keys(result)).toEqual(['url', 'confirmation_code']);
  });

  it.each(['deauthorize', 'dataDeletion'] as const)('%s: 400 when the signed_request does not verify; nothing runs', async (method) => {
    meta.parseSignedRequest.mockResolvedValue(null);
    await expect(controller[method](req(10), { signed_request: 'bad' })).rejects.toBeInstanceOf(BadRequestException);
    expect(meta.deauthorize).not.toHaveBeenCalled();
    expect(meta.requestDeletion).not.toHaveBeenCalled();
  });

  it('status lookup proxies to the service', async () => {
    expect(await controller.deletionStatus('abc')).toEqual({ code: 'ABC', status: 'completed' });
    expect(meta.deletionStatus).toHaveBeenCalledWith('abc');
  });
});
