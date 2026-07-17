import { Injectable } from '@nestjs/common';
import { Agent } from '@mastra/core/agent';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { resolveOrgIdFromModelContext } from '@gitroom/nestjs-libraries/chat/agents/resolve-org-context';
import { pickTools } from '@gitroom/nestjs-libraries/chat/agents/specialist-tool-subset';

export const MEDIA_TOOL_NAMES = [
  'listMediaProviders',
  'listMediaModels',
  'mediaStudioGenerate',
  'mediaJobStatus',
  'generateImageTool',
  'generateVideoTool',
  'uploadFromUrlTool',
  'designerDesign',
  'filesSearch',
  'stockSearch',
];

@Injectable()
export class MediaAgentBuilder {
  constructor(private _aiModelProvider: AIModelProvider) {}

  agent(tools: Record<string, any>) {
    return new Agent({
      id: 'media',
      name: 'media',
      description: 'Specialist agent for media generation, stock search, and the file library.',
      instructions: `
You are the media specialist for Postmill.

Your job:
- Generate images and videos for posts (generateImageTool / generateVideoTool for the fast path; mediaStudioGenerate for provider-specific work).
- List configured providers and models before generating when the user asks for a specific studio.
- Poll submitted jobs with mediaJobStatus until they complete.
- Search the file library (filesSearch) and free stock catalogs (stockSearch) to find existing assets.
- Upload media from a URL with uploadFromUrlTool.
- Open assets in the Designer with designerDesign.

Rules:
- Always confirm provider/model and rough cost before calling mediaStudioGenerate.
- Return job ids and clear next steps after starting a generation.
- Do not schedule posts; hand off to the ops specialist for publishing.
`,
      model: (context: any) =>
        this._aiModelProvider.languageModel(
          'utility',
          resolveOrgIdFromModelContext(context),
        ),
      tools: pickTools(tools, MEDIA_TOOL_NAMES),
    });
  }
}
