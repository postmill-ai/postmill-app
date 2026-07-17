import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';
import { IntegrationSchedulePostTool } from './integration.schedule.post';
import { GenerateVideoTool } from '@gitroom/nestjs-libraries/chat/tools/generate.video.tool';
import { GenerateImageTool } from '@gitroom/nestjs-libraries/chat/tools/generate.image.tool';
import { IntegrationListTool } from '@gitroom/nestjs-libraries/chat/tools/integration.list.tool';
import { GroupListTool } from '@gitroom/nestjs-libraries/chat/tools/group.list.tool';
import { UploadFromUrlTool } from '@gitroom/nestjs-libraries/chat/tools/upload.from.url.tool';
import { DesignerDesignTool } from '@gitroom/nestjs-libraries/chat/tools/designer.design.tool';

// Phase 1 capability tools
import { AnalyticsOverviewTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.overview.tool';
import { AnalyticsBestTimeTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.best-time.tool';
import { AnalyticsRecommendationsTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.recommendations.tool';
import { AnalyticsPostTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.post.tool';
import { AnalyticsWatchlistTool } from '@gitroom/nestjs-libraries/chat/tools/analytics.watchlist.tool';
import { ListMediaProvidersTool } from '@gitroom/nestjs-libraries/chat/tools/media.providers.tool';
import { ListMediaModelsTool } from '@gitroom/nestjs-libraries/chat/tools/media.models.tool';
import { MediaStudioGenerateTool } from '@gitroom/nestjs-libraries/chat/tools/media.studio.generate.tool';
import { MediaJobStatusTool } from '@gitroom/nestjs-libraries/chat/tools/media.job.status.tool';
import { CampaignCreateTool } from '@gitroom/nestjs-libraries/chat/tools/campaign.create.tool';
import { CampaignUpdateTool } from '@gitroom/nestjs-libraries/chat/tools/campaign.update.tool';
import { CampaignDashboardTool } from '@gitroom/nestjs-libraries/chat/tools/campaign.dashboard.tool';
import { CampaignTagTool } from '@gitroom/nestjs-libraries/chat/tools/campaign.tag.tool';
import { CommentsInboxTool } from '@gitroom/nestjs-libraries/chat/tools/comments.inbox.tool';
import { CommentReplyTool } from '@gitroom/nestjs-libraries/chat/tools/comments.reply.tool';
import { GenerateContentTool } from '@gitroom/nestjs-libraries/chat/tools/generate.content.tool';
import { RunGeneratorTool } from '@gitroom/nestjs-libraries/chat/tools/run.generator.tool';
import { RunContentPipelineTool } from '@gitroom/nestjs-libraries/chat/tools/run.content.pipeline.tool';
import { PostsListTool } from '@gitroom/nestjs-libraries/chat/tools/posts.list.tool';
import { PostsGetTool } from '@gitroom/nestjs-libraries/chat/tools/posts.get.tool';
import { PostsRescheduleTool } from '@gitroom/nestjs-libraries/chat/tools/posts.reschedule.tool';
import { PostsDeleteTool } from '@gitroom/nestjs-libraries/chat/tools/posts.delete.tool';
import { PostsApproveTool } from '@gitroom/nestjs-libraries/chat/tools/posts.approve.tool';
import { FilesSearchTool } from '@gitroom/nestjs-libraries/chat/tools/files.search.tool';
import { StockSearchTool } from '@gitroom/nestjs-libraries/chat/tools/stock.search.tool';
import { RagSearchTool } from '@gitroom/nestjs-libraries/chat/tools/rag.search.tool';
import { BrandMemorySearchTool } from '@gitroom/nestjs-libraries/chat/tools/brand.memory.search.tool';
import { BrandProfileTool } from '@gitroom/nestjs-libraries/chat/tools/brand.profile.tool';
import { BrandMemoryReindexTool } from '@gitroom/nestjs-libraries/chat/tools/brand.memory.reindex.tool';

export const toolList = [
  // Existing tools
  IntegrationListTool,
  GroupListTool,
  IntegrationValidationTool,
  IntegrationTriggerTool,
  IntegrationSchedulePostTool,
  GenerateVideoTool,
  GenerateImageTool,
  UploadFromUrlTool,
  DesignerDesignTool,

  // Phase 1: analytics
  AnalyticsOverviewTool,
  AnalyticsBestTimeTool,
  AnalyticsRecommendationsTool,
  AnalyticsPostTool,
  AnalyticsWatchlistTool,

  // Phase 1: media studios
  ListMediaProvidersTool,
  ListMediaModelsTool,
  MediaStudioGenerateTool,
  MediaJobStatusTool,

  // Phase 1: campaigns
  CampaignCreateTool,
  CampaignUpdateTool,
  CampaignDashboardTool,
  CampaignTagTool,

  // Phase 1: comments
  CommentsInboxTool,
  CommentReplyTool,

  // Phase 1: content
  GenerateContentTool,
  RunGeneratorTool,
  RunContentPipelineTool,

  // Phase 2: memory / brand / RAG
  RagSearchTool,
  BrandMemorySearchTool,
  BrandProfileTool,
  BrandMemoryReindexTool,

  // Phase 1: posts/calendar
  PostsListTool,
  PostsGetTool,
  PostsRescheduleTool,
  PostsDeleteTool,
  PostsApproveTool,

  // Phase 1: files & stock
  FilesSearchTool,
  StockSearchTool,
];
