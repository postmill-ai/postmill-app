import { Command, Positional } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';

@Injectable()
export class AgentRun {
  constructor(private _agentGraphService: AgentGraphService) {}
  @Command({
    command: 'run:agent <org>',
    // NOTE: this runs a real generator pass and SPENDS the given org's AI budget
    // (budget-gated in AgentGraphService.start). Pass a valid org id.
    describe: "Run the agent for an org (spends that org's AI budget)",
  })
  async agentRun(
    @Positional({
      name: 'org',
      describe: 'Organization id to run the agent for',
      type: 'string',
    })
    org: string
  ) {
    if (!org || !org.trim()) {
      throw new Error('An organization id is required: run:agent <org>');
    }
    // start() is async (up-front budget gate); await it before iterating.
    const stream = await this._agentGraphService.start(org, {
      research: 'Write a short post about scheduling social media content',
      isPicture: false,
      format: 'one_short',
      tone: 'company',
    });
    for await (const event of stream) {
      console.log(event);
    }
  }
}
