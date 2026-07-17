import { Injectable } from '@nestjs/common';
import {
  InngestFunctionRunView,
  InngestRunRepository,
} from '@gitroom/nestjs-libraries/database/prisma/inngest-runs/inngest-run.repository';

// Thin service wrapper around InngestRunRepository so Inngest function factories
// receive a service rather than the repository directly (layering refactor A-09/A-10).
@Injectable()
export class InngestRunService {
  constructor(private readonly _repo: InngestRunRepository) {}

  recordStart(functionId: string): Promise<string> {
    return this._repo.recordStart(functionId);
  }

  recordComplete(functionId: string, startedAtIso: string): Promise<void> {
    return this._repo.recordComplete(functionId, startedAtIso);
  }

  recordFailed(
    functionId: string,
    startedAtIso: string,
    error: string
  ): Promise<void> {
    return this._repo.recordFailed(functionId, startedAtIso, error);
  }

  getAllLatest(): Promise<InngestFunctionRunView[]> {
    return this._repo.getAllLatest();
  }
}
