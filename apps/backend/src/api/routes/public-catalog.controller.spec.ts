import { describe, it, expect, vi } from 'vitest';
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { PublicCatalogController } from './public-catalog.controller';

describe('PublicCatalogController — registration', () => {
  it('is registered as a PUBLIC controller (NOT in authenticatedController): the marketing site reads it anonymously', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'api.module.ts'), 'utf8');
    const block = source.match(/authenticatedController = \[([\s\S]*?)\];/);
    expect(block, 'authenticatedController array not found').toBeTruthy();
    expect(block![1]).not.toContain('PublicCatalogController');
    expect(source).toContain('PublicCatalogController,');
  });

  it('is cacheable and readable cross-origin (no cookies involved)', () => {
    const headers = Reflect.getMetadata('__headers__', PublicCatalogController.prototype.list) as Array<{
      name: string;
      value: string;
    }>;
    const byName = Object.fromEntries(headers.map((h) => [h.name, h.value]));
    expect(byName['Cache-Control']).toContain('public');
    expect(byName['Access-Control-Allow-Origin']).toBe('*');
  });
});

describe('PublicCatalogController', () => {
  const make = () => {
    const service = { build: vi.fn().mockResolvedValue({ total: 1, domains: [] }) };
    return { service, controller: new PublicCatalogController(service as any) };
  };

  it('returns the full catalogue without a filter', async () => {
    const { service, controller } = make();
    await expect(controller.list()).resolves.toEqual({ total: 1, domains: [] });
    expect(service.build).toHaveBeenCalledWith();
  });

  it('passes a valid domain filter through', async () => {
    const { service, controller } = make();
    await controller.list('social');
    expect(service.build).toHaveBeenCalledWith('social');
  });

  it('rejects unknown (or non-public) domains with 400', async () => {
    const { service, controller } = make();
    await expect(controller.list('email')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list('nope')).rejects.toBeInstanceOf(BadRequestException);
    expect(service.build).not.toHaveBeenCalled();
  });
});
