import { InngestRunService } from '@gitroom/nestjs-libraries/inngest/inngest-run.service';

// Minimal structural slice of the Inngest step tools — only `run` is needed here.
type TrackStep = { run(id: string, fn: () => any): Promise<any> };

// Wraps a cron function's work in three memoized steps: record-start, then on settle
// record-complete or record-failed. Each is its own `step.run`, so a retry/resume never
// double-writes, and the failure path re-throws so Inngest still sees the error.
// `startedAt` is memoized in the start step, so duration is computed against the true
// first-execution time even across resumes. Keep any trailing `step.sleep` OUTSIDE the
// wrapped `work` so the sleep is excluded from the recorded duration.
export async function trackRun<T>(
  step: TrackStep,
  runRepo: InngestRunService,
  functionId: string,
  work: () => Promise<T>
): Promise<T> {
  const startedAt: string = await step.run(`${functionId}:track-start`, () =>
    runRepo.recordStart(functionId)
  );
  try {
    const result = await work();
    await step.run(`${functionId}:track-complete`, () =>
      runRepo.recordComplete(functionId, startedAt)
    );
    return result;
  } catch (e: any) {
    await step.run(`${functionId}:track-failed`, () =>
      runRepo.recordFailed(functionId, startedAt, String(e?.message ?? e))
    );
    throw e;
  }
}
