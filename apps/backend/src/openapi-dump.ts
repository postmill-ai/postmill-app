// Dumps the OpenAPI document to stdout as JSON, without starting an HTTP listener.
//
// Invoked by tools/codegen/generate-openapi.mjs, which serializes the result to
// openapi.yml. Constructing AppModule instantiates every provider, so this needs the
// same env a real boot needs (DATABASE_URL, REDIS_URL, JWT_SECRET) — which is why the
// CI drift gate lives in boot-guard.yml, the job that already provisions them.
//
// Must be first: installs the runtime resolver for bare `@postmill-ai/provider-*`
// imports before any transitive require of a provider package (mirrors main.ts).
import './register-provider-paths';

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { buildSwaggerDocument } from '@postmill-ai/helpers/swagger/load.swagger';

process.env.TZ = 'UTC';

async function dump() {
  const app = await NestFactory.create(AppModule, {
    logger: false,
    abortOnError: false,
  });

  // Routes are only registered once the app is initialized; createDocument reads
  // them off the container, so init before building or the document comes back empty.
  await app.init();

  const document = buildSwaggerDocument(app, {
    version: process.env.OPENAPI_VERSION,
  });

  await app.close();

  // stdout is the transport — keep it clean. Anything diagnostic goes to stderr.
  //
  // Await the flush explicitly: when stdout is a pipe (which it is under the
  // generator's spawn) writes are asynchronous, so a process.exit() immediately
  // after would truncate this ~400KB payload and the consumer would see invalid
  // JSON. Writing to a file happens to be synchronous, which makes the bug look
  // like it isn't there when you test by redirecting.
  const json = JSON.stringify(document, null, 2);
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(json, (err) => (err ? reject(err) : resolve()));
  });
}

dump().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
