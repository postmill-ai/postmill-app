import { Module } from '@nestjs/common';
import { CommandModule as ExternalCommandModule } from 'nestjs-command';
import { DatabaseModule } from '@gitroom/nestjs-libraries/database/prisma/database.module';
import { RefreshTokens } from './tasks/refresh.tokens';
import { ConfigurationTask } from './tasks/configuration';
import { AgentRun } from './tasks/agent.run';
import { BackfillProviderVersions } from './tasks/backfill-provider-versions';
import { SeedDemo } from './tasks/seed-demo';
import { AgentModule } from '@gitroom/nestjs-libraries/agent/agent.module';

@Module({
  imports: [ExternalCommandModule, DatabaseModule, AgentModule],
  controllers: [],
  providers: [RefreshTokens, ConfigurationTask, AgentRun, BackfillProviderVersions, SeedDemo],
  get exports() {
    return [...this.imports, ...this.providers];
  },
})
export class CommandModule {}
