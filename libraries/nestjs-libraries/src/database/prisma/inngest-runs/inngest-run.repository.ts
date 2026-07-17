import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export interface InngestFunctionRunView {
  functionId: string;
  startedAt: Date;
  completedAt: Date | null;
  durationMs: number | null;
  status: string;
}

const ERROR_MAX_LEN = 500;

// One row per Inngest cron function, keyed on the unique `functionId` (upsert), so the
// per-minute crons never grow the table. Records the latest run's timing/status for /health.
@Injectable()
export class InngestRunRepository {
  constructor(private _runs: PrismaRepository<'inngestFunctionRun'>) {}

  // Marks the function as running and stamps a fresh start time. Returns the ISO start
  // timestamp so the matching complete/failed call can compute duration without a re-read.
  async recordStart(functionId: string): Promise<string> {
    const startedAt = new Date();
    await this._runs.model.inngestFunctionRun.upsert({
      where: { functionId },
      create: { functionId, startedAt, status: 'running' },
      update: {
        startedAt,
        status: 'running',
        completedAt: null,
        durationMs: null,
        error: null,
      },
    });
    return startedAt.toISOString();
  }

  async recordComplete(functionId: string, startedAtIso: string): Promise<void> {
    const completedAt = new Date();
    await this._runs.model.inngestFunctionRun.update({
      where: { functionId },
      data: {
        completedAt,
        durationMs: completedAt.getTime() - new Date(startedAtIso).getTime(),
        status: 'completed',
        error: null,
      },
    });
  }

  async recordFailed(
    functionId: string,
    startedAtIso: string,
    error: string
  ): Promise<void> {
    const completedAt = new Date();
    await this._runs.model.inngestFunctionRun.update({
      where: { functionId },
      data: {
        completedAt,
        durationMs: completedAt.getTime() - new Date(startedAtIso).getTime(),
        status: 'failed',
        error: (error || '').slice(0, ERROR_MAX_LEN),
      },
    });
  }

  async getAllLatest(): Promise<InngestFunctionRunView[]> {
    return this._runs.model.inngestFunctionRun.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        functionId: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        status: true,
      },
    });
  }
}
