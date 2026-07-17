import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class MigrationLedgerRepository {
  constructor(private _ledger: PrismaRepository<'migrationLedger'>) {}

  async wasApplied(key: string): Promise<boolean> {
    const row = await this._ledger.model.migrationLedger.findUnique({
      where: { key },
    });
    return !!row;
  }

  async markApplied(
    key: string,
    durationMs?: number,
    note?: string
  ): Promise<void> {
    await this._ledger.model.migrationLedger.upsert({
      where: { key },
      create: { key, durationMs, note },
      update: { durationMs, note },
    });
  }
}
