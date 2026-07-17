import { Global, Module } from '@nestjs/common';
import { LoadToolsService } from '@gitroom/nestjs-libraries/chat/load.tools.service';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { ContentAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/content.agent';
import { MediaAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/media.agent';
import { AnalyticsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/analytics.agent';
import { OpsAgentBuilder } from '@gitroom/nestjs-libraries/chat/agents/ops.agent';
import { ContentPipelineModule } from '@gitroom/nestjs-libraries/chat/content-pipeline/content-pipeline.module';

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
