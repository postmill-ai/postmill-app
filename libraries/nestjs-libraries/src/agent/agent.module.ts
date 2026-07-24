import { Global, Module } from '@nestjs/common';
import { AgentGraphService } from '@postmill-ai/nestjs-libraries/agent/agent.graph.service';
import { AgentGraphInsertService } from '@postmill-ai/nestjs-libraries/agent/agent.graph.insert.service';

@Global()
@Module({
  providers: [AgentGraphService, AgentGraphInsertService],
  get exports() {
    return this.providers;
  },
})
export class AgentModule {}
