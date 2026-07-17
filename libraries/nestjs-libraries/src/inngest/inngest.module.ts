import { Module } from '@nestjs/common';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { PostActivity } from './activities/post.activity';
import { AnalyticsActivity } from './activities/analytics.activity';
import { CommentsActivity } from './activities/comments.activity';
import { EmailActivity } from './activities/email.activity';
import { IntegrationsActivity } from './activities/integrations.activity';
import { AutopostActivity } from './activities/autopost.activity';
import { MediaJobsActivity } from './activities/media-jobs.activity';
import { DigestActivity } from './activities/digest.activity';
import { CampaignActivity } from './activities/campaign.activity';
import { RetentionActivity } from './activities/retention.activity';
import { RetentionRepository } from '@gitroom/nestjs-libraries/database/prisma/retention/retention.repository';
import { AgentDigestActivity } from './activities/agent-digest.activity';
import { InngestService } from './inngest.service';
import { InngestRunService } from './inngest-run.service';

@Module({
  imports: [DatabaseModule],
  providers: [
    PostActivity,
    AnalyticsActivity,
    CommentsActivity,
    EmailActivity,
    IntegrationsActivity,
    AutopostActivity,
    MediaJobsActivity,
    DigestActivity,
    CampaignActivity,
    RetentionActivity,
    RetentionRepository,
    AgentDigestActivity,
    InngestRunService,
    InngestService,
  ],
  exports: [
    PostActivity,
    AnalyticsActivity,
    CommentsActivity,
    EmailActivity,
    IntegrationsActivity,
    AutopostActivity,
    MediaJobsActivity,
    DigestActivity,
    CampaignActivity,
    RetentionActivity,
    RetentionRepository,
    AgentDigestActivity,
    InngestRunService,
    InngestService,
  ],
})
export class InngestModule {}
