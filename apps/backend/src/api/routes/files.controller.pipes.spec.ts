import { describe, it, expect } from 'vitest';
import 'reflect-metadata';
import { PIPES_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { CustomFileValidationPipe } from '@postmill-ai/nestjs-libraries/upload/custom.upload.validation';

import { FilesController } from './files.controller';
import { PublicIntegrationsController } from '../../public-api/routes/v1/public.integrations.controller';

/**
 * Regression guard for the bug that made EVERY upload 400 with
 * "Invalid file upload.".
 *
 * `CustomFileValidationPipe` only understands multer file objects. Bound with a
 * method-scoped `@UsePipes()` it also runs on `@Body()` and on custom param
 * decorators — `createParamDecorator` assigns a uid *string* paramtype, and
 * Nest's `isPipeable()` accepts `isString(type)`
 * (@nestjs/core/router/router-execution-context.js) — so it rejected the
 * `org`/`body` arguments before the handler ever ran.
 *
 * The existing upload specs call the controller methods directly, which skips
 * Nest's pipe pipeline entirely and therefore cannot catch this. Asserting on
 * the decorator metadata can, and survives refactors of the handler bodies.
 */

type RouteArgs = Record<string, { index: number; pipes?: unknown[] }>;

const routeArgs = (target: object, method: string): RouteArgs =>
  Reflect.getMetadata(ROUTE_ARGS_METADATA, target.constructor, method) ?? {};

const methodPipes = (proto: object, method: string): unknown[] =>
  Reflect.getMetadata(PIPES_METADATA, (proto as never)[method]) ?? [];

const hasFileValidationPipe = (pipes: unknown[] = []) =>
  pipes.some((p) => p instanceof CustomFileValidationPipe);

const uploadHandlers: [string, object, string][] = [
  ['FilesController.uploadServer', FilesController.prototype, 'uploadServer'],
  ['FilesController.uploadSimple', FilesController.prototype, 'uploadSimple'],
  [
    'PublicIntegrationsController.uploadSimple',
    PublicIntegrationsController.prototype,
    'uploadSimple',
  ],
];

describe.each(uploadHandlers)('%s pipe binding', (_name, proto, method) => {
  it('does not bind CustomFileValidationPipe at method scope', () => {
    expect(hasFileValidationPipe(methodPipes(proto, method))).toBe(false);
  });

  it('binds CustomFileValidationPipe to the FILE param', () => {
    const args = routeArgs(proto, method);
    const fileEntries = Object.entries(args).filter(([key]) =>
      key.startsWith(`${RouteParamtypes.FILE}:`)
    );

    expect(fileEntries).toHaveLength(1);
    expect(hasFileValidationPipe(fileEntries[0][1].pipes)).toBe(true);
  });

  it('leaves non-file params free of the file pipe', () => {
    const args = routeArgs(proto, method);
    const nonFile = Object.entries(args).filter(
      ([key]) => !key.startsWith(`${RouteParamtypes.FILE}:`)
    );

    // org (custom decorator) and, where present, body — these are the params the
    // method-scoped binding used to reject.
    expect(nonFile.length).toBeGreaterThan(0);
    for (const [key, meta] of nonFile) {
      expect(
        hasFileValidationPipe(meta.pipes),
        `${key} must not receive the file-validation pipe`
      ).toBe(false);
    }
  });
});
