import { Global, Module } from '@nestjs/common';
import { LoadToolsService } from '@postmill-ai/nestjs-libraries/chat/load.tools.service';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { toolList } from '@postmill-ai/nestjs-libraries/chat/tools/tool.list';
import { ContentAgentBuilder } from '@postmill-ai/nestjs-libraries/chat/agents/content.agent';
import { MediaAgentBuilder } from '@postmill-ai/nestjs-libraries/chat/agents/media.agent';
import { AnalyticsAgentBuilder } from '@postmill-ai/nestjs-libraries/chat/agents/analytics.agent';
import { OpsAgentBuilder } from '@postmill-ai/nestjs-libraries/chat/agents/ops.agent';
import { ContentPipelineModule } from '@postmill-ai/nestjs-libraries/chat/content-pipeline/content-pipeline.module';

@Global()
@Module({
  imports: [ContentPipelineModule],
  providers: [
    MastraService,
    LoadToolsService,
    ContentAgentBuilder,
    MediaAgentBuilder,
    AnalyticsAgentBuilder,
    OpsAgentBuilder,
    ...toolList,
  ],
  get exports() {
    return this.providers;
  },
})
export class ChatModule {}
