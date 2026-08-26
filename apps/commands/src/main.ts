// Must be first: installs the runtime resolver for bare `@postmill-ai/provider-*` imports
// (see register-provider-paths.ts) before any transitive require of a provider package.
import './register-provider-paths';
import { NestFactory } from '@nestjs/core';
import { CommandModule } from './command.module';
import { CommandService } from 'nestjs-command';

async function bootstrap() {
  // some comment again
  const app = await NestFactory.createApplicationContext(CommandModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    await app.select(CommandModule).get(CommandService).exec();
    await app.close();
  } catch (error) {
    console.error(error);
    await app.close();
    process.exit(1);
  }
}

bootstrap();
