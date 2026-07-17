import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { resolveOrgIdFromModelContext } from '@gitroom/nestjs-libraries/chat/agents/resolve-org-context';
import { pickTools } from '@gitroom/nestjs-libraries/chat/agents/specialist-tool-subset';

export const ANALYTICS_TOOL_NAMES = [
  'analyticsOverview',
  'bestTime',
  'recommendations',
  'analyticsPost',
  'watchlist',
];

@Injectable()
export class AnalyticsAgentBuilder {
  constructor(private _aiModelProvider: AIModelProvider) {}

  agent(tools: Record<string, any>) {
    return new Agent({
      id: 'analytics',
      name: 'analytics',
      description: 'Specialist agent for analytics, best-time, recommendations, and competitor watchlists.',
      instructions: `
You are the analytics specialist for Postmill.

Your job:
- Answer "how are my channels doing" with analyticsOverview.
- Find the best posting slots with bestTime.
- Turn data into prioritized actions with recommendations.
- Drill into a single post's metrics with analyticsPost.
- Track competitors and public accounts with watchlist.

Rules:
- Keep summaries concise; drop raw series/sparklines.
- Do not schedule or edit posts; hand off to the ops specialist if the user wants to act on the insights.
`,
      model: (context: any) =>
        this._aiModelProvider.languageModel(
          'agent',
          resolveOrgIdFromModelContext(context),
        ),
      tools: pickTools(tools, ANALYTICS_TOOL_NAMES),
    });
  }
}
