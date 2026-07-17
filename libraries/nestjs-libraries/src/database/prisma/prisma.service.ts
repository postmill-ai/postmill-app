import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Build an optional `datasourceUrl` override that appends Prisma connection-pool
 * params (`connection_limit` / `pool_timeout`) when the matching env vars are set.
 * Returns `undefined` when neither is set so PrismaClient is constructed exactly as
 * before (byte-for-byte unchanged default behaviour).
 */
function buildPooledDatasourceUrl(): string | undefined {
  const connectionLimit = process.env.DATABASE_CONNECTION_LIMIT;
  const poolTimeout = process.env.DATABASE_POOL_TIMEOUT;
  if (!connectionLimit && !poolTimeout) {
    return undefined;
  }

  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) {
    return undefined;
  }

  try {
    const url = new URL(baseUrl);
    if (connectionLimit) {
      url.searchParams.set('connection_limit', connectionLimit);
    }
    if (poolTimeout) {
      url.searchParams.set('pool_timeout', poolTimeout);
    }
    return url.toString();
  } catch {
    // Malformed DATABASE_URL — leave it untouched and let Prisma surface the error.
    return undefined;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const datasourceUrl = buildPooledDatasourceUrl();
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
      ...(datasourceUrl ? { datasourceUrl } : {}),
    });
  }
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaRepository<T extends keyof PrismaService> {
  public model: Pick<PrismaService, T>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }

  async $queryRaw<TResult = unknown>(query: TemplateStringsArray, ...values: any[]): Promise<TResult> {
    return this._prismaService.$queryRaw(query, ...values);
  }
}

@Injectable()
export class PrismaTransaction {
  public model: Pick<PrismaService, '$transaction'>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}
