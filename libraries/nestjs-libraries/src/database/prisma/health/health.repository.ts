import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

// Repository for the readiness probe (/health/ready). Only the repository touches Prisma
// (layering law); the controller calls ping() and never queries directly.
@Injectable()
export class HealthRepository {
  constructor(private _health: PrismaRepository<'organization'>) {}

  // Cheap liveness check on the database connection. Throws if the DB is unreachable.
  async ping(): Promise<boolean> {
    await this._health.$queryRaw`SELECT 1`;
    return true;
  }
}
