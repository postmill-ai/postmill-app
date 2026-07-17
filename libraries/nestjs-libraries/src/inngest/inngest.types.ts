import { EventSchemas } from 'inngest';
import { ChannelSnapshotIntegrationRef } from './activities/analytics.activity';

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

};

export const inngestSchemas = new EventSchemas().fromRecord<InngestEvents>();
