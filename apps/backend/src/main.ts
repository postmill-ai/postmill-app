// Must be first: installs the runtime resolver for bare `@gitroom/provider-*` imports
// (see register-provider-paths.ts) before any transitive require of a provider package.
import './register-provider-paths';
import { initializeOtel } from '@gitroom/nestjs-libraries/otel/initialize.otel';
// Start OpenTelemetry first — before Sentry init and before the Nest app is created — so
// auto-instrumentations can patch modules as they load. No-ops unless configured (G3).
initializeOtel();
import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('backend', true);
import compression from 'compression';

import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { json } from 'express';

process.env.TZ = 'UTC';

import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';

import { SubscriptionExceptionFilter } from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { PostValidationExceptionFilter } from '@gitroom/backend/api/routes/posts.validation.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@gitroom/helpers/configuration/configuration.checker';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';
import { isDev } from '@gitroom/helpers/utils/is.dev';
import { CollaborationGateway } from './services/collaboration/collaboration.gateway';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

// v3.6.0 added BigInt columns (e.g. Organization.localStorageQuotaBytes,
// StorageProviderConfig.quotaBytes). Express serializes responses with
// JSON.stringify, which throws on BigInt ("Do not know how to serialize a
// BigInt") — 500ing every endpoint that returns such an entity (e.g.
// /user/organizations). Serialize BigInt as a JS number, matching the
// numeric shape the frontend already expects from storage endpoints.
(BigInt.prototype as any).toJSON = function () {
  return Number(this);
};

// `nest start --watch` spawns this process through a wrapper shell and on
// recompile kills only that shell — the old server is orphaned (reparented to
// init), keeps the port, and serves stale code while leaking ~700 MB per edit.
// Exit when our parent dies so the freshly compiled instance can bind.
if (isDev()) {
  setInterval(() => {
    if (process.ppid === 1) process.exit(0);
  }, 2000).unref();
}

async function start() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      ...(!process.env.NOT_SECURED || process.env.NODE_ENV !== 'development' ? { credentials: true } : {}),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'auth',
        'showorg',
        'impersonate',
        'x-csrf-token',
        'x-copilotkit-runtime-client-gql-version',
      ],
      exposedHeaders: [
        'reload',
        'onboarding',
        'activate',
        'x-copilotkit-runtime-client-gql-version',
        ...(process.env.NODE_ENV === 'development' && process.env.NOT_SECURED ? ['auth', 'showorg', 'impersonate'] : []),
      ],
      origin: [
        process.env.FRONTEND_URL,
        'http://localhost:6274',
        ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
      ],
    },
  });

  // Graceful shutdown (G1): drain Redis/Prisma (via onModuleDestroy) on SIGTERM/SIGINT.
  // Enabled before listen; the handler runs app.close() exactly once. This is additive to
  // the dev `ppid===1` watcher above (which handles the nest-watch orphan case separately).
  app.enableShutdownHooks();

  // Socket.IO runs on the same HTTP server via the NestJS IoAdapter.
  // The `/ai-designer` namespace is handled by AiDesignerGateway.
  // `as any` works around a type-only mismatch between `@nestjs/platform-socket.io`
  // and `@nestjs/websockets` bindMessageHandlers signatures; runtime is unaffected.
  app.useWebSocketAdapter(new IoAdapter(app) as any);

  let shuttingDown = false;
  const gracefulShutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    new Logger('Bootstrap').log(`Received ${signal}, shutting down gracefully...`);
    try {
      await app.close();
    } catch (e) {
      new Logger('Bootstrap').error('Error during graceful shutdown', e as Error);
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  await startMcp(app);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  app.use(['/copilot/{*splat}', '/posts'], (req: any, res: any, next: any) => {
    json({ limit: '50mb' })(req, res, next);
  });

  app.use(cookieParser());
  app.use(compression());

  // NOT_SECURED is the universal dev toggle — relax helmet ONLY in development. A stray
  // prod NOT_SECURED must not strip CSP/HSTS/frameguard/noSniff wholesale (same re-guard
  // as the auth cookies in auth.controller.ts). Noted quirk (not changed): isDev() is
  // also true when NODE_ENV is unset, so an unset-NODE_ENV deploy still gets no helmet.
  const notSecuredDev = process.env.NOT_SECURED && process.env.NODE_ENV === 'development';
  if (!isDev() && !notSecuredDev) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const helmet = require('helmet');
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'", 'https://api.github.com'],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      frameguard: { action: 'deny' },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      xssFilter: true,
    }));
  }
  app.useGlobalFilters(new SubscriptionExceptionFilter());
  app.useGlobalFilters(new PostValidationExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  loadSwagger(app);

  const port = process.env.PORT || 3000;

  // Fail-fast config validation BEFORE accepting traffic (A1). In production (or when
  // CONFIG_CHECK_STRICT is set) a fatal-missing secret exits non-zero before listen.
  checkConfiguration();

  // Multi-replica websocket hazard (A4): the collaboration gateway holds a live Y.Doc
  // per room, and the AI Designer gateway keeps in-memory rate buckets, Socket.IO rooms,
  // and conductor pipeline state. Warn loudly if the operator opted out of single-instance
  // without wiring a Redis adapter (not yet implemented — tracked follow-up).
  if (
    process.env.COLLAB_SINGLE_INSTANCE === 'false' &&
    !process.env.COLLAB_REDIS_ADAPTER
  ) {
    new Logger('Bootstrap').warn(
      'COLLAB_SINGLE_INSTANCE=false but COLLAB_REDIS_ADAPTER is not set. The /collaboration ' +
        'and /ai-designer websockets keep per-room state in memory; running multiple replicas ' +
        'without a shared Redis adapter will silently diverge and lose edits or AI Designer ' +
        'sessions. Pin these namespaces to one replica (sticky sessions) or configure a Redis ' +
        'adapter. See docs/operations-guide/scaling.md and docs/developer-docs/designer.md.'
    );
  }

  try {
    // Optional explicit bind host. Default (unset) preserves the current
    // behavior — `app.listen(port)` binds Node's default address. Set
    // BACKEND_LISTEN_HOST=0.0.0.0 to force IPv4 (e.g. in CI, where the default
    // binds IPv6-only and browsers that prefer 127.0.0.1 get ECONNREFUSED).
    const listenHost = process.env.BACKEND_LISTEN_HOST;
    await (listenHost ? app.listen(port, listenHost) : app.listen(port));
    new Logger('Bootstrap').log(
      'Backend started successfully on port ' +
        port +
        ' (bind host: ' +
        (listenHost || 'default') +
        ', address: ' +
        JSON.stringify(app.getHttpServer().address()) +
        ')',
    );

    const server = app.getHttpServer();
    const collabGateway = app.get(CollaborationGateway);
    const usersService = app.get(UsersService);
    const organizationService = app.get(OrganizationService);
    collabGateway.initialize(server, async (token: string) => {
      try {
        const payload = AuthService.verifyJWT(token) as { id: string } | null;
        if (!payload?.id) return null;
        const user = await usersService.getUserById(payload.id);
        if (!user) return null;
        const orgs = await organizationService.getOrgsByUserId(user.id);
        if (!orgs?.length) return null;
        return { userId: user.id, orgId: orgs[0].id };
      } catch {
        return null;
      }
    });

    Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  } catch (e) {
    Logger.error(`Backend failed to start on port ${port}`, e);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  // Fail-fast (A1): refuse to boot on a fatal-missing secret in production, or anywhere
  // CONFIG_CHECK_STRICT is set. NOT_SECURED (the universal dev toggle) bypasses the exit.
  if (checker.hasFatalIssues()) {
    const failFast =
      !!process.env.CONFIG_CHECK_STRICT ||
      (process.env.NODE_ENV === 'production' && !process.env.NOT_SECURED);

    for (const issue of checker.getFatalIssues()) {
      Logger.error(issue, 'Fatal configuration issue');
    }

    if (failFast) {
      Logger.error(
        'Refusing to start: ' +
          checker.getFatalIssues().length +
          ' fatal configuration issue(s). Fix them or set NOT_SECURED for local dev.'
      );
      process.exit(1);
    }
  }

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

start();
