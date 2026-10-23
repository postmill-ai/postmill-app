import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DesignImportValidationPipe } from '@postmill-ai/nestjs-libraries/upload/design-import.validation';

vi.mock('@postmill-ai/nestjs-libraries/database/prisma/federation/federation.service', () => ({
  FEDERATION_AUDIENCE: 'postmill-template-store',
  FederationService: class {},
}));

import { FederationController } from './federation.controller';

const TTL_KEY = 'THROTTLER:TTLdefault';
const LIMIT_KEY = 'THROTTLER:LIMITdefault';

describe('FederationController install-template', () => {
  let federationService: { installTemplate: ReturnType<typeof vi.fn> };
  let controller: FederationController;

  beforeEach(() => {
    federationService = { installTemplate: vi.fn() };
    controller = new FederationController(federationService as any);
  });

  it('binds DesignImportValidationPipe to the FILE param (not method scope)', () => {
    const args =
      Reflect.getMetadata(ROUTE_ARGS_METADATA, FederationController, 'installTemplate') ?? {};
    const fileEntries = Object.entries(args).filter(([key]) =>
      key.startsWith(`${RouteParamtypes.FILE}:`)
    );
    expect(fileEntries).toHaveLength(1);
    expect(
      (fileEntries[0][1] as any).pipes.some(
        (p: unknown) => p instanceof DesignImportValidationPipe
      )
    ).toBe(true);
  });

  it('carries the same 20/min throttle as the token endpoint', () => {
    expect(Reflect.getMetadata(LIMIT_KEY, FederationController.prototype.installTemplate)).toBe(20);
    expect(Reflect.getMetadata(TTL_KEY, FederationController.prototype.installTemplate)).toBe(60000);
  });

  it('401s without a Bearer posf_ token before touching the service', async () => {
    for (const header of [undefined, 'Basic abc', 'Bearer pos_something']) {
      await expect(
        controller.installTemplate(header, { originalname: 't.pdesign' } as any)
      ).rejects.toMatchObject({ status: 401 });
    }
    expect(federationService.installTemplate).not.toHaveBeenCalled();
  });

  it('delegates to the service with the token and file, returning designId + openUrl', async () => {
    const file = { originalname: 't.pdesign', path: '/tmp/x' } as any;
    federationService.installTemplate.mockResolvedValue({
      designId: 'design-1',
      openUrl: 'https://app.example.com/media/designer?designId=design-1',
    });

    const out = await controller.installTemplate('Bearer posf_abc', file);

    expect(federationService.installTemplate).toHaveBeenCalledWith('posf_abc', file);
    expect(out).toEqual({
      designId: 'design-1',
      openUrl: 'https://app.example.com/media/designer?designId=design-1',
    });
  });

  it('propagates the 403 insufficient_scope from the service', async () => {
    federationService.installTemplate.mockRejectedValue(
      new HttpException({ error: 'insufficient_scope' }, 403)
    );

    await expect(
      controller.installTemplate('Bearer posf_abc', { originalname: 't.pdesign' } as any)
    ).rejects.toMatchObject({ status: 403 });
  });
});
