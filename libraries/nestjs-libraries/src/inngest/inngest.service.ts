import { Injectable } from '@nestjs/common';
import { inngest } from './inngest.client';
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
import { AgentDigestActivity } from './activities/agent-digest.activity';
import { InngestRunService } from './inngest-run.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { createFunctions } from '@gitroom/backend/inngest/functions';
import { InngestFunction } from 'inngest';

@Injectable()
export class InngestService {
  private readonly functions: InngestFunction<any, any, any>[];

  constructor(
    postActivity: PostActivity,
    analyticsActivity: AnalyticsActivity,
    commentsActivity: CommentsActivity,
    emailActivity: EmailActivity,
    integrationsActivity: IntegrationsActivity,
    autopostActivity: AutopostActivity,
    mediaJobsActivity: MediaJobsActivity,
    digestActivity: DigestActivity,
    campaignActivity: CampaignActivity,
    retentionActivity: RetentionActivity,
    agentDigestActivity: AgentDigestActivity,
    inngestRunService: InngestRunService,
    organizationService: OrganizationService
  ) {
    // Built in the constructor (not onModuleInit) so consumers that read
    // getFunctions() in their own constructor — e.g. InngestController, which
    // depends on this service and is therefore instantiated after it — see the
    // populated list. Nest runs every constructor before any onModuleInit hook.
    this.functions = createFunctions({
      postActivity,
      analyticsActivity,
      commentsActivity,
      emailActivity,
      integrationsActivity,
      autopostActivity,
      mediaJobsActivity,
      digestActivity,
      campaignActivity,
      retentionActivity,
      agentDigestActivity,
      inngestRunService,
      organizationService,
    });
  }

  getFunctions(): InngestFunction<any, any, any>[] {
    return this.functions;
  }

  getClient() {
    return inngest;
  }
}
