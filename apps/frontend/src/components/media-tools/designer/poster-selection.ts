export interface PosterJobSnapshot {
  id: string;
  thumbnailUrl: string | null;
}

export const mergePosterPoll = <T extends PosterJobSnapshot>(
  requested: T[],
  polled: T[],
  current: T[]
): T[] =>
  current.map((currentJob) => {
    const before = requested.find((job) => job.id === currentJob.id);
    const next = polled.find((job) => job.id === currentJob.id);
    if (!next) return currentJob;
    if (before && before.thumbnailUrl !== currentJob.thumbnailUrl) {
      return { ...next, thumbnailUrl: currentJob.thumbnailUrl };
    }
    return next;
  });
