import { describe, it, expect } from 'vitest';
import 'reflect-metadata';

import { DashboardController } from '../dashboard.controller';
import { DesignController } from '../design.controller';
import { HeyGenController } from '../heygen.controller';
import { MediaStudioController } from '../media-studio.controller';
import { NotificationsController } from '../notifications.controller';
import { ReplicateStudioController } from '../replicate-studio.controller';

// The throttle bucket is per (controller, handler, org) — NOT one global 600/h budget —
// so an endpoint the frontend polls every few seconds burns through the default on its
// own and 429s a perfectly healthy session. Every handler below is polled at 2-30s and
// must carry an explicit hourly cap with headroom over the worst poller (2s x N jobs).
//
// @Throttle writes plain reflect-metadata keys; assert those directly.
const TTL_KEY = 'THROTTLER:TTLdefault';
const LIMIT_KEY = 'THROTTLER:LIMITdefault';

const HOUR_MS = 3600000;
const MIN_POLL_LIMIT = 2000;

const polledHandlers: Array<[string, (...args: any[]) => any]> = [
  ['GET /dashboard/media-jobs', DashboardController.prototype.getMediaJobs],
  ['GET /media/studio/:provider/jobs', MediaStudioController.prototype.getJobs],
  ['GET /media/heygen/jobs', HeyGenController.prototype.getJobs],
  ['GET /media/replicate/jobs/:id', ReplicateStudioController.prototype.getJob],
  [
    'GET /media/designs/render-video/:jobId',
    DesignController.prototype.getVideoRenderStatus,
  ],
  ['GET /notifications', NotificationsController.prototype.mainPageList],
  ['GET /notifications/list', NotificationsController.prototype.notifications],
];

describe('polled endpoints carry a raised @Throttle cap', () => {
  it.each(polledHandlers)('%s', (_name, handler) => {
    expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(HOUR_MS);
    expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBeGreaterThanOrEqual(
      MIN_POLL_LIMIT
    );
  });
});
