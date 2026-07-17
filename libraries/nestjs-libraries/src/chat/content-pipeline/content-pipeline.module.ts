import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Global, Module } from '@nestjs/common';
import { ContentPipelineMeshModule } from './content-pipeline-mesh.module';
import { StrategistService } from './agents/strategist.service';
import { CopywriterService } from './agents/copywriter.service';
import { BrandCriticService } from './agents/brand-critic.service';
import { FinalizerService } from './agents/finalizer.service';
import { ContentPipelineConductorService } from './content-pipeline-conductor.service';

@Global()
@Module({
  imports: [ContentPipelineMeshModule],
  providers: [
    StrategistService,
    CopywriterService,
    BrandCriticService,
    FinalizerService,
    ContentPipelineConductorService,
  ],
  exports: [ContentPipelineConductorService],
})
export class ContentPipelineModule {}
