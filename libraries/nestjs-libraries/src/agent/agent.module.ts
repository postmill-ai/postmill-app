import { Global, Module } from '@nestjs/common';
import { AgentGraphService } from '@postmill-ai/nestjs-libraries/agent/agent.graph.service';

@Global()
@Module({
  providers: [AgentGraphService],
  get exports() {
    return this.providers;
  },
})
export class AgentModule {}
