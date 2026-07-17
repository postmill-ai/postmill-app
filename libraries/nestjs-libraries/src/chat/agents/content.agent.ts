import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { resolveOrgIdFromModelContext } from '@gitroom/nestjs-libraries/chat/agents/resolve-org-context';
import { pickTools } from '@gitroom/nestjs-libraries/chat/agents/specialist-tool-subset';

export const CONTENT_TOOL_NAMES = [
  'generatePostContent',
  'runGenerator',
  'runContentPipeline',
  'ragSearch',
  'brandMemorySearch',
  'brandProfile',
  'brandMemoryReindex',
];

@Injectable()
export class ContentAgentBuilder {
  constructor(private _aiModelProvider: AIModelProvider) {}

  agent(tools: Record<string, any>) {
    return new Agent({
      id: 'content',
      name: 'content',
      description: 'Specialist agent for copy, brand voice, and content generation.',
      instructions: `
You are the content specialist for Postmill.

Your job:
- Draft, rewrite, or brainstorm social media copy.
- Ground output in the organization's brand voice and past top-performing posts.
- Use brandMemorySearch / ragSearch to find exemplars before generating.
- Use generatePostContent for quick one-shot copy, runGenerator for research-grounded posts/threads, or runContentPipeline for brand-critiqued multi-platform copy.
- Use brandProfile to quote brand rules and brandMemoryReindex only when the user explicitly asks to refresh the brand memory index.

Rules:
- Return concise, ready-to-post copy unless the user asks for options.
- Respect platform formats (HTML with p/li/ul/strong/h1-h3, no nested u+strong).
- Do not schedule posts or perform outward actions; hand off to the ops specialist if the user wants to publish.
`,
      model: (context: any) =>
        this._aiModelProvider.languageModel(
          'agent',
          resolveOrgIdFromModelContext(context),
        ),
      tools: pickTools(tools, CONTENT_TOOL_NAMES),
    });
  }
}
