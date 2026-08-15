import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

// Fallback only. The real version is stamped by the caller: the generator
// (tools/codegen/generate-openapi.mjs) passes the root package.json version, which
// is what lands in the published openapi.yml. Resolving package.json by relative
// path from here is not viable — the compiled file sits under
// apps/backend/dist/libraries/helpers/..., so the path differs from source layout.
const FALLBACK_VERSION = '1.0.0';

/**
 * Builds the OpenAPI document. Split out from `loadSwagger` so the generator can
 * produce the exact document the running app serves at /docs, without starting a
 * listener.
 */
export const buildSwaggerDocument = (
  app: INestApplication,
  opts: { version?: string } = {}
) => {
  const config = new DocumentBuilder()
    .setTitle('Postmill API')
    .setDescription(
      'OpenAPI description of the Postmill backend (NestJS). Generated from the ' +
        'controllers — do not hand-edit; run `pnpm run openapi:generate`.'
    )
    .setVersion(opts.version || process.env.NEXT_PUBLIC_VERSION || FALLBACK_VERSION)
    // Public API auth (J3): clients authenticate by putting their API key in the
    // `Authorization` header. The same header also accepts an OAuth bearer token,
    // so both schemes are documented for a usable generated client.
    .addApiKey(
      { type: 'apiKey', name: 'Authorization', in: 'header' },
      'api-key'
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'Token' },
      'bearer'
    )
    .build();

  return SwaggerModule.createDocument(app, config);
};

export const loadSwagger = (app: INestApplication) => {
  SwaggerModule.setup('docs', app, buildSwaggerDocument(app));
};
