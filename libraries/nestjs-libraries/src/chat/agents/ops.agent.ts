import { Injectable } from '@nestjs/common';
import {
  specialistCommsRules,
  specialistPreamble,
} from '@postmill-ai/nestjs-libraries/chat/agents/comms-surface';
import { Agent } from '@mastra/core/agent';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { resolveOrgIdFromModelContext } from '@postmill-ai/nestjs-libraries/chat/agents/resolve-org-context';
import { pickTools } from '@postmill-ai/nestjs-libraries/chat/agents/specialist-tool-subset';

export const OPS_TOOL_NAMES = [
  'integrationSchema',
  'triggerTool',
  'schedulePostTool',
  'listPosts',
  'getPost',
  'reschedulePost',
  'deletePost',
  'approveDraft',
  'campaignCreate',
  'campaignUpdate',
  'campaignDashboard',
  'campaignTag',
  'commentsInbox',
  'commentReply',
];

@Injectable()
export class OpsAgentBuilder {
  constructor(private _aiModelProvider: AIModelProvider) {}

  agent(tools: Record<string, any>) {
    return new Agent({
      id: 'ops',
      name: 'ops',
      description: 'Specialist agent for scheduling, campaigns, comments, and post operations.',
      instructions: ({ requestContext }: { requestContext?: any }) => `${specialistPreamble()}You are the operations specialist for Postmill.

Your job:
- Schedule and manage posts: integrationSchema → triggerTool → schedulePostTool.
- List, get, reschedule, delete, and approve drafts with the posts/calendar tools.
- Create, update, tag, and view campaigns.
- Triage and reply to synced social comments with commentsInbox and commentReply.

Rules:
- Call integrationSchema before scheduling to learn each channel's settings.
- schedulePostTool's integrationId is the channel's id field as listed by integrationList (a long opaque id) — never a platform name like "slack" or "linkedin". If you were given only a name/platform, say so instead of guessing.
- Dates you pass to tools are absolute ISO-8601 UTC, resolved from the current date above ("tomorrow 10:00 UTC" = the next calendar day at 10:00:00Z).
- Ask for explicit user confirmation before outward actions (schedule, delete, commentReply, campaign create/update/tag, approveDraft) when ui mode is true.
- Post content must be HTML with allowed tags: h1, h2, h3, u, strong, li, ul, p (u and strong cannot be nested).
- Do not generate media or analytics; hand off to the media/analytics specialists for those requests.
${specialistCommsRules(requestContext)}`,
      model: (context: any) =>
        this._aiModelProvider.languageModel(
          'utility',
          resolveOrgIdFromModelContext(context),
        ),
      tools: pickTools(tools, OPS_TOOL_NAMES),
    });
  }
}
