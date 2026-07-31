import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@postmill-ai/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { ConfigurationTask } from './tasks/configuration';
import { AgentRun } from './tasks/agent.run';
import { BackfillProviderVersions } from './tasks/backfill-provider-versions';
import { BackfillDesignThumbnails } from './tasks/backfill-design-thumbnails';
import { SeedDemo } from './tasks/seed-demo';
import { AgentModule } from '@postmill-ai/nestjs-libraries/agent/agent.module';
import { UploadModule } from '@postmill-ai/nestjs-libraries/upload/upload.module';
import { AiModule } from '@postmill-ai/nestjs-libraries/ai/ai.module';
import { ProvidersModule } from '@postmill-ai/nestjs-libraries/providers/providers.module';
import { FeatureFlagsModule } from '@postmill-ai/nestjs-libraries/feature-flags/feature-flags.module';
import { VpnModule } from '@postmill-ai/nestjs-libraries/vpn/vpn.module';
import { MediaStudioModule } from '@postmill-ai/nestjs-libraries/media/studio/studio.module';
import { ProvidersBootstrap } from '@postmill-ai/backend/providers.bootstrap';

@Module({
  // UploadModule/AiModule/ProvidersModule/FeatureFlagsModule/VpnModule are
  // @Global — DatabaseModule's services (IntegrationService→StorageService,
  // PostsService→RagService, OrgProviderConfigService→OrgVpnConfigService, …)
  // depend on providers only those modules export. Mirrors the global set in
  // apps/backend/src/app.module.ts (minus ChatModule — its toolList pulls
  // MediaStudioService through a chain the standalone app can't satisfy and
  // the commands don't need it).
  imports: [
    ExternalCommandModule,
    DatabaseModule,
    AgentModule,
    UploadModule,
    AiModule,
    ProvidersModule,
    FeatureFlagsModule,
    VpnModule,
    MediaStudioModule,
  ],
  controllers: [],
  // ProvidersBootstrap registers every provider package with the kernel —
  // without it, resolution (e.g. storage/local@v1) fails with
  // "Provider not found" in the standalone commands context.
  providers: [RefreshTokens, ConfigurationTask, AgentRun, BackfillProviderVersions, BackfillDesignThumbnails, SeedDemo, ProvidersBootstrap],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
