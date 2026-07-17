import { Module } from '@nestjs/common';
import { AiModule } from '@gitroom/nestjs-libraries/ai/ai.module';
import { ReplicateCatalogService } from './replicate-catalog.service';
import { ReplicateRunnerService } from './replicate-runner.service';
import { ReplicateCostService } from './replicate-cost';
import { ReplicateEnhanceService } from './replicate-enhance.service';

@Module({
  imports: [AiModule],
  providers: [
    ReplicateCatalogService,
    ReplicateRunnerService,
    ReplicateCostService,
    ReplicateEnhanceService,
  ],
  exports: [
    ReplicateCatalogService,
    ReplicateRunnerService,
    ReplicateCostService,
    ReplicateEnhanceService,
  ],
})
export class ReplicateStudioModule {}
