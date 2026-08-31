import { eventType, staticSchema } from 'inngest';
import type { ChannelSnapshotIntegrationRef } from './activities/analytics.activity';

export type InngestEvents = {
  'post/publish': {
    data: {
      postId: string;
      organizationId: string;
      taskQueue: string;
      maxConcurrentJob: number;
      postNow?: boolean;
    };
  };
  'post/cancel': {
    data: {
      postId: string;
    };
  };
  'email/send': {
    data: {
      to: string;
      subject: string;
      html: string;
      replyTo?: string;
      addTo?: 'top' | 'bottom';
    };
  };
  'autopost/process': {
    data: {
      id: string;
      organizationId: string;
    };
  };
  'autopost/cancel': {
    data: {
      id: string;
    };
  };
  'integration/refresh-token': {
    data: {
      integrationId: string;
      organizationId: string;
      // F3: consecutive failed refresh cycles so far — the chain terminates
      // once this hits the function's retry cap.
      retries?: number;
    };
  };
  'integration/refresh-token/cancel': {
    data: {
      integrationId: string;
    };
  };
  'streak/start': {
    data: {
      organizationId: string;
    };
  };
  'streak/cancel': {
    data: {
      organizationId: string;
    };
  };
  'analytics/backfill': {
    data: {
      integrationId: string;
      organizationId: string;
    };
  };
  'comments/sync-org': {
    data: {
      organizationId: string;
      daysBack: number;
    };
  };
  'analytics/sync-org': {
    data: {
      organizationId: string;
    };
  };
  'analytics/sync-integration': {
    data: ChannelSnapshotIntegrationRef;
  };
  'digest/send-one': {
    data: {
      userId: string;
      email: string;
      organizationId: string;
      frequency: 'daily' | 'weekly';
    };
  };
  'media/render': {
    data: {
      jobId: string;
      op: 'design' | 'merge';
    };
  };
  'media/poll-job': {
    data: {
      jobId: string;
    };
  };
  'agent/digest-org': {
    data: {
      organizationId: string;
    };
  };
  'comms/inbound.message': {
    data: {
      configId: string;
      organizationId: string;
      identifier: string;
      externalUserId: string;
      externalChannelId?: string;
      text: string;
      messageId?: string;
    };
  };
  'comms/matrix.sync-one': {
    data: {
      configId: string;
      organizationId: string;
    };
  };

};

// Inngest v4 removed the client-level `EventSchemas`; typed events are now
// decentralized `eventType()` definitions carrying a type-only
// `staticSchema()` (no runtime validation). Pass them directly as function
// triggers so handlers keep a typed `event.data`. **Add new events to
// `InngestEvents` first**, then export their `eventType` here.
export const postPublishEvent = eventType('post/publish', {
  schema: staticSchema<InngestEvents['post/publish']['data']>(),
});
export const emailSendEvent = eventType('email/send', {
  schema: staticSchema<InngestEvents['email/send']['data']>(),
});
export const autopostProcessEvent = eventType('autopost/process', {
  schema: staticSchema<InngestEvents['autopost/process']['data']>(),
});
export const integrationRefreshTokenEvent = eventType(
  'integration/refresh-token',
  { schema: staticSchema<InngestEvents['integration/refresh-token']['data']>() }
);
export const streakStartEvent = eventType('streak/start', {
  schema: staticSchema<InngestEvents['streak/start']['data']>(),
});
export const analyticsBackfillEvent = eventType('analytics/backfill', {
  schema: staticSchema<InngestEvents['analytics/backfill']['data']>(),
});
export const commentsSyncOrgEvent = eventType('comments/sync-org', {
  schema: staticSchema<InngestEvents['comments/sync-org']['data']>(),
});
export const commsInboundMessageEvent = eventType('comms/inbound.message', {
  schema: staticSchema<InngestEvents['comms/inbound.message']['data']>(),
});
export const commsMatrixSyncOneEvent = eventType('comms/matrix.sync-one', {
  schema: staticSchema<InngestEvents['comms/matrix.sync-one']['data']>(),
});
export const analyticsSyncOrgEvent = eventType('analytics/sync-org', {
  schema: staticSchema<InngestEvents['analytics/sync-org']['data']>(),
});
export const analyticsSyncIntegrationEvent = eventType(
  'analytics/sync-integration',
  { schema: staticSchema<InngestEvents['analytics/sync-integration']['data']>() }
);
export const digestSendOneEvent = eventType('digest/send-one', {
  schema: staticSchema<InngestEvents['digest/send-one']['data']>(),
});
export const mediaRenderEvent = eventType('media/render', {
  schema: staticSchema<InngestEvents['media/render']['data']>(),
});
export const mediaPollJobEvent = eventType('media/poll-job', {
  schema: staticSchema<InngestEvents['media/poll-job']['data']>(),
});
export const agentDigestOrgEvent = eventType('agent/digest-org', {
  schema: staticSchema<InngestEvents['agent/digest-org']['data']>(),
});
