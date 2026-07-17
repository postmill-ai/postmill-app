import { PostActivity } from '@gitroom/nestjs-libraries/inngest/activities/post.activity';
import { AnalyticsActivity } from '@gitroom/nestjs-libraries/inngest/activities/analytics.activity';
import { CommentsActivity } from '@gitroom/nestjs-libraries/inngest/activities/comments.activity';
import { EmailActivity } from '@gitroom/nestjs-libraries/inngest/activities/email.activity';
import { IntegrationsActivity } from '@gitroom/nestjs-libraries/inngest/activities/integrations.activity';
import { AutopostActivity } from '@gitroom/nestjs-libraries/inngest/activities/autopost.activity';
import { MediaJobsActivity } from '@gitroom/nestjs-libraries/inngest/activities/media-jobs.activity';
import { DigestActivity } from '@gitroom/nestjs-libraries/inngest/activities/digest.activity';
import { CampaignActivity } from '@gitroom/nestjs-libraries/inngest/activities/campaign.activity';
import { RetentionActivity } from '@gitroom/nestjs-libraries/inngest/activities/retention.activity';
import { AgentDigestActivity } from '@gitroom/nestjs-libraries/inngest/activities/agent-digest.activity';
import { InngestRunService } from '@gitroom/nestjs-libraries/inngest/inngest-run.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  createAnalyticsCollection,
  createAnalyticsSyncOrg,
  createAnalyticsSyncIntegration,
} from './analytics-collection';
import { createCommentsCollection, createCommentsSyncOrg } from './comments-collection';
import { createMissingPostFinder } from './missing-post-finder';
import { createMediaJobsPoll } from './media-jobs-poll';
import { createMediaJobsPollJob } from './media-jobs-poll-job';
import { createMediaRender } from './media-render';
import { createSendEmail } from './send-email';
import {
  createDigestEmailDaily,
  createDigestSendOne,
} from './digest-email-daily';
import { createDigestEmailWeekly } from './digest-email-weekly';
import { createAgentDigest, createAgentDigestOrg } from './agent-digest';
import { createCampaignTagPurge } from './campaign-tag-purge';
import { createRetentionPurge } from './retention-purge';
import { createAutopostProcess } from './autopost-process';
import { createRefreshToken } from './refresh-token';
import { createStreakTracker } from './streak-tracker';
import { createAnalyticsBackfill } from './analytics-backfill';
import { createPostPublishFunctions } from './post-publish';

export interface InngestActivities {
  postActivity: PostActivity;
  analyticsActivity: AnalyticsActivity;
  commentsActivity: CommentsActivity;
  emailActivity: EmailActivity;
  integrationsActivity: IntegrationsActivity;
  autopostActivity: AutopostActivity;
  mediaJobsActivity: MediaJobsActivity;
  digestActivity: DigestActivity;
  campaignActivity: CampaignActivity;
  retentionActivity: RetentionActivity;
  agentDigestActivity: AgentDigestActivity;
  inngestRunService: InngestRunService;
  organizationService: OrganizationService;
}

export const createFunctions = (activities: InngestActivities) => [
  createAnalyticsCollection(activities.analyticsActivity, activities.inngestRunService),
  createAnalyticsSyncOrg(activities.analyticsActivity),
  createAnalyticsSyncIntegration(activities.analyticsActivity),
  createCommentsCollection(activities.commentsActivity, activities.inngestRunService),
  createCommentsSyncOrg(activities.commentsActivity),
  createMissingPostFinder(activities.postActivity, activities.inngestRunService),
  createMediaJobsPoll(activities.mediaJobsActivity, activities.inngestRunService),
  createMediaJobsPollJob(activities.mediaJobsActivity),
  createMediaRender(activities.mediaJobsActivity),
  createSendEmail(activities.emailActivity),
  createDigestEmailDaily(activities.digestActivity),
  createDigestEmailWeekly(activities.digestActivity),
  createDigestSendOne(activities.digestActivity),
  createAgentDigest(activities.agentDigestActivity, activities.organizationService),
  createAgentDigestOrg(activities.agentDigestActivity),
  createCampaignTagPurge(activities.campaignActivity, activities.inngestRunService),
  createRetentionPurge(activities.retentionActivity, activities.inngestRunService),
  createAutopostProcess(activities.autopostActivity),
  createRefreshToken(activities.integrationsActivity),
  createStreakTracker(activities.emailActivity, activities.postActivity),
  createAnalyticsBackfill(activities.analyticsActivity),
  ...createPostPublishFunctions(activities.postActivity),
];
