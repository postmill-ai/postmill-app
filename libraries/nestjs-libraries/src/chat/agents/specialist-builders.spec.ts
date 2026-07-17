import { describe, it, expect, vi } from 'vitest';
import { ContentAgentBuilder } from './content.agent';
import { MediaAgentBuilder } from './media.agent';
import { AnalyticsAgentBuilder } from './analytics.agent';
import { OpsAgentBuilder } from './ops.agent';
import { pickTools } from './specialist-tool-subset';
import { toolList } from '@gitroom/nestjs-libraries/chat/tools/tool.list';
import { IntegrationValidationTool } from '@gitroom/nestjs-libraries/chat/tools/integration.validation.tool';
import { IntegrationTriggerTool } from '@gitroom/nestjs-libraries/chat/tools/integration.trigger.tool';

const mockIntegrationManager = {
  getAllowedSocialsIntegrations: () => ['x', 'linkedin'],
  getSocialIntegrationUnchecked: () => ({}),
};

const instantiateTool = (ToolClass: any): any => {
  if (ToolClass === IntegrationValidationTool) {
    return new ToolClass(mockIntegrationManager);
  }
  if (ToolClass === IntegrationTriggerTool) {
    return new ToolClass(mockIntegrationManager, {}, {});
  }
  return Reflect.construct(ToolClass, new Array(ToolClass.length).fill(undefined));
};

const buildFlatTools = async (): Promise<Record<string, any>> => {
  const entries = await Promise.all(
    toolList.map(async (ToolClass: any) => {
      const instance = instantiateTool(ToolClass);
      const tool = await instance.run();
      return { name: instance.name as string, tool };
    })
  );
  return entries.reduce(
    (acc, { name, tool }) => ({ ...acc, [name]: tool }),
    {} as Record<string, any>
  );
};

describe('Specialist agent builders', () => {
  const aiModelProvider = {
    languageModel: vi.fn().mockReturnValue({ id: 'fake-model' }),
  } as any;

  it('content agent exposes only content tools', async () => {
    const tools = await buildFlatTools();
    const agent = new ContentAgentBuilder(aiModelProvider).agent(tools);
    const agentTools = await (agent as any).listTools();

    const ids = Object.values(agentTools).map((t: any) => t.id);
    expect(ids).toContain('generatePostContent');
    expect(ids).toContain('runGenerator');
    expect(ids).toContain('ragSearch');
    expect(ids).toContain('brandMemorySearch');
    expect(ids).toContain('brandProfile');
    expect(ids).toContain('brandMemoryReindex');
    expect(ids).not.toContain('analyticsOverview');
    expect(ids).not.toContain('mediaStudioGenerate');
    expect(ids).not.toContain('schedulePostTool');
    expect(agent.id).toBe('content');
    expect(agent.hasOwnMemory()).toBe(false);
  });

  it('media agent exposes only media tools', async () => {
    const tools = await buildFlatTools();
    const agent = new MediaAgentBuilder(aiModelProvider).agent(tools);
    const agentTools = await (agent as any).listTools();

    const ids = Object.values(agentTools).map((t: any) => t.id);
    expect(ids).toContain('listMediaProviders');
    expect(ids).toContain('listMediaModels');
    expect(ids).toContain('mediaStudioGenerate');
    expect(ids).toContain('mediaJobStatus');
    expect(ids).toContain('generateImageTool');
    expect(ids).toContain('generateVideoTool');
    expect(ids).toContain('uploadFromUrlTool');
    expect(ids).toContain('designerDesign');
    expect(ids).toContain('filesSearch');
    expect(ids).toContain('stockSearch');
    expect(ids).not.toContain('analyticsOverview');
    expect(ids).not.toContain('generatePostContent');
    expect(ids).not.toContain('schedulePostTool');
    expect(agent.id).toBe('media');
    expect(agent.hasOwnMemory()).toBe(false);
  });

  it('analytics agent exposes only analytics tools', async () => {
    const tools = await buildFlatTools();
    const agent = new AnalyticsAgentBuilder(aiModelProvider).agent(tools);
    const agentTools = await (agent as any).listTools();

    const ids = Object.values(agentTools).map((t: any) => t.id);
    expect(ids).toContain('analyticsOverview');
    expect(ids).toContain('bestTime');
    expect(ids).toContain('recommendations');
    expect(ids).toContain('analyticsPost');
    expect(ids).toContain('watchlist');
    expect(ids).not.toContain('generatePostContent');
    expect(ids).not.toContain('mediaStudioGenerate');
    expect(ids).not.toContain('schedulePostTool');
    expect(agent.id).toBe('analytics');
    expect(agent.hasOwnMemory()).toBe(false);
  });

  it('ops agent exposes only ops tools', async () => {
    const tools = await buildFlatTools();
    const agent = new OpsAgentBuilder(aiModelProvider).agent(tools);
    const agentTools = await (agent as any).listTools();

    const ids = Object.values(agentTools).map((t: any) => t.id);
    expect(ids).toContain('integrationSchema');
    expect(ids).toContain('triggerTool');
    expect(ids).toContain('schedulePostTool');
    expect(ids).toContain('listPosts');
    expect(ids).toContain('getPost');
    expect(ids).toContain('reschedulePost');
    expect(ids).toContain('deletePost');
    expect(ids).toContain('approveDraft');
    expect(ids).toContain('campaignCreate');
    expect(ids).toContain('campaignUpdate');
    expect(ids).toContain('campaignDashboard');
    expect(ids).toContain('campaignTag');
    expect(ids).toContain('commentsInbox');
    expect(ids).toContain('commentReply');
    expect(ids).not.toContain('analyticsOverview');
    expect(ids).not.toContain('generatePostContent');
    expect(ids).not.toContain('mediaStudioGenerate');
    expect(agent.id).toBe('ops');
    expect(agent.hasOwnMemory()).toBe(false);
  });

  it('pickTools resolves tools by either map key or createTool id', () => {
    const tools = {
      integrationSchedulePostTool: { id: 'schedulePostTool' },
      integrationSchema: { id: 'integrationSchema' },
    };

    const picked = pickTools(tools, [
      'integrationSchema',
      'schedulePostTool', // id, not key
    ]);

    expect(Object.keys(picked)).toEqual([
      'integrationSchema',
      'integrationSchedulePostTool',
    ]);
  });
});
