import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PublicDesignShareController } from './public.design-share.controller';
import { PublicApiModule } from '../public.api.module';
import { CreateDesignShareCommentDto } from '@postmill-ai/nestjs-libraries/dtos/design/design-share.dto';

const TTL_KEY = 'THROTTLER:TTLdefault';
const LIMIT_KEY = 'THROTTLER:LIMITdefault';

describe('PublicDesignShareController', () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: PublicDesignShareController;

  beforeEach(() => {
    service = {
      getPublicPreview: vi.fn(),
      renderPublicPreview: vi.fn().mockResolvedValue(Buffer.from('png')),
      addComment: vi.fn(),
      approve: vi.fn(),
    };
    controller = new PublicDesignShareController(service as any);
  });

  it('is registered as a public controller, not a session-authenticated controller', () => {
    const controllers = Reflect.getMetadata('controllers', PublicApiModule) as any[];
    expect(controllers).toContain(PublicDesignShareController);
  });

  it('delegates token-scoped reads and feedback mutations', async () => {
    await controller.getPublicPreview('token');
    await controller.addComment('token', { name: 'Client', content: 'Hello' });
    await controller.approve('token', { name: 'Client' });
    expect(service.getPublicPreview).toHaveBeenCalledWith('token');
    expect(service.addComment).toHaveBeenCalledWith('token', 'Client', 'Hello');
    expect(service.approve).toHaveBeenCalledWith('token', 'Client');
  });

  it('returns public preview PNGs without a shared cache', async () => {
    const res = { setHeader: vi.fn(), end: vi.fn() };
    await controller.renderPublicPreview('token', 0, 1, res as any);
    expect(service.renderPublicPreview).toHaveBeenCalledWith('token', 0, 1);
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(res.end).toHaveBeenCalledWith(Buffer.from('png'));
  });

  it.each(['renderPublicPreview', 'addComment', 'approve'] as const)(
    'limits %s to 10 requests per minute',
    (method) => {
      expect(Reflect.getMetadata(TTL_KEY, PublicDesignShareController.prototype[method])).toBe(60000);
      expect(Reflect.getMetadata(LIMIT_KEY, PublicDesignShareController.prototype[method])).toBe(10);
    },
  );

  it('rejects undeclared fields through the global DTO contract', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform(
      { name: 'Client', content: 'Hello', organizationId: 'other-org' },
      { type: 'body', metatype: CreateDesignShareCommentDto },
    )).rejects.toBeInstanceOf(BadRequestException);
  });
});
