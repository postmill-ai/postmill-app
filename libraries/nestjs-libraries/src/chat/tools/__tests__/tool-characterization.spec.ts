import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IntegrationListTool } from '../integration.list.tool';
import { GroupListTool } from '../group.list.tool';
import { IntegrationValidationTool } from '../integration.validation.tool';
import { IntegrationTriggerTool } from '../integration.trigger.tool';
import { IntegrationSchedulePostTool } from '../integration.schedule.post';
import { GenerateVideoTool } from '../generate.video.tool';
import { GenerateImageTool } from '../generate.image.tool';
import { UploadFromUrlTool } from '../upload.from.url.tool';
import { DesignerDesignTool } from '../designer.design.tool';
import { DesignerDocService } from '@gitroom/nestjs-libraries/media/designer-doc/designer-doc.service';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file-type.compat';
import { executeTool, makeOrganization, makeUser } from './tool-test.harness';

vi.mock('@gitroom/nestjs-libraries/upload/file-type.compat', () => ({
  fromBuffer: vi.fn(),
}));

function makeFetchResponse(body: Buffer, contentType = 'image/png') {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

describe('agent tool characterization', () => {
  const org = makeOrganization();
  const user = makeUser();

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(makeFetchResponse(Buffer.from('image-data')))
    );
  });

  it('IntegrationListTool returns a list of integrations', async () => {
    const integrationService = {
      getIntegrationsList: vi.fn().mockResolvedValue([
        {
          name: 'X Account',
          id: 'int-1',
          disabled: false,
          picture: 'https://example.com/x.png',
          providerIdentifier: 'x',
          profile: 'test',
          type: 'social',
          customer: null,
        },
      ]),
    };
    const tool = new IntegrationListTool(integrationService as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toHaveProperty('output');
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output[0]).toMatchObject({
      id: 'int-1',
      name: 'X Account',
      picture: 'https://example.com/x.png',
      platform: 'x',
    });
  });

  it('GroupListTool returns a list of groups', async () => {
    const integrationService = {
      customers: vi.fn().mockResolvedValue([{ id: 'cust-1', name: 'Acme' }]),
    };
    const tool = new GroupListTool(integrationService as any);

    const result = await executeTool(tool, {
      inputData: {},
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toHaveProperty('output');
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output[0]).toEqual({ id: 'cust-1', name: 'Acme' });
  });

  it('IntegrationValidationTool returns a validation schema', async () => {
    const integrationManager = {
      getAllowedSocialsIntegrations: vi.fn().mockReturnValue(['x', 'linkedin']),
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue({
        identifier: 'x',
        maxLength: vi.fn().mockReturnValue(280),
        dto: undefined,
      }),
      getAllTools: vi.fn().mockReturnValue({ x: [] }),
      getAllRulesDescription: vi.fn().mockReturnValue({ x: 'X rules' }),
    };
    const tool = new IntegrationValidationTool(integrationManager as any);

    const result = await executeTool(tool, {
      inputData: { isPremium: false, platform: 'x' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(result).toHaveProperty('output');
    expect(result.output).toMatchObject({
      rules: 'X rules',
      maxLength: 280,
      tools: [],
    });
  });

  it('IntegrationTriggerTool invokes a provider tool and returns its output', async () => {
    const integration = {
      providerIdentifier: 'x',
      token: 'token-1',
      internalId: 'internal-1',
    };
    const integrationProvider = {
      identifier: 'x',
      search: vi.fn().mockResolvedValue([{ id: 'result-1', name: 'Result' }]),
    };
    const integrationService = {
      getIntegrationById: vi.fn().mockResolvedValue(integration),
    };
    const integrationManager = {
      getSocialIntegrationUnchecked: vi.fn().mockReturnValue(integrationProvider),
      getAllTools: vi.fn().mockReturnValue({
        x: [{ methodName: 'search', description: 'Search', dataSchema: [] }],
      }),
    };
    const refreshIntegrationService = {
      refresh: vi.fn().mockResolvedValue(null),
    };
    const tool = new IntegrationTriggerTool(
      integrationManager as any,
      integrationService as any,
      refreshIntegrationService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        integrationId: 'int-1',
        methodName: 'search',
        dataSchema: [{ key: 'q', value: 'hello' }],
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(integrationProvider.search).toHaveBeenCalled();
    expect(result).toHaveProperty('output');
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output[0]).toMatchObject({ id: 'result-1', name: 'Result' });
  });

  it('IntegrationTriggerTool denies without an access context', async () => {
    const tool = new IntegrationTriggerTool({} as any, {} as any, {} as any);

    await expect(
      executeTool(tool, {
        inputData: {
          integrationId: 'int-1',
          methodName: 'search',
          dataSchema: [{ key: 'q', value: 'hello' }],
        },
        organization: org,
        user,
        // no access seed → deny-by-default
      })
    ).rejects.toThrow(/Read access denied/);
  });

  it('IntegrationSchedulePostTool schedules a post and returns post ids', async () => {
    const integration = { id: 'int-1', providerIdentifier: 'x' };
    const integrationService = {
      getIntegrationById: vi.fn().mockResolvedValue(integration),
    };
    const postsService = {
      validatePosts: vi.fn().mockResolvedValue([
        {
          valid: true,
          errors: true,
          emptyContent: false,
          tooLong: false,
          name: 'X Account',
        },
      ]),
      createPost: vi.fn().mockResolvedValue([{ postId: 'post-1', integration: 'x' }]),
    };
    const guardrailService = {
      checkOutput: vi.fn().mockImplementation((content: string) => Promise.resolve(content)),
    };
    const subscriptionService = {
      getSubscriptionByOrganizationId: vi.fn().mockResolvedValue(null),
      getSubscription: vi.fn().mockResolvedValue(null),
    };
    const tool = new IntegrationSchedulePostTool(
      postsService as any,
      integrationService as any,
      guardrailService as any,
      subscriptionService as any
    );

    const result = await executeTool(tool, {
      inputData: {
        socialPost: [
          {
            integrationId: 'int-1',
            isPremium: false,
            date: new Date().toISOString(),
            shortLink: false,
            type: 'schedule',
            postsAndComments: [
              { content: '<p>Hello world</p>', attachments: [] },
            ],
            settings: [],
          },
        ],
      },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(postsService.createPost).toHaveBeenCalled();
    expect(result).toHaveProperty('output');
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output[0]).toMatchObject({ postId: 'post-1', integration: 'x' });
  });

  it('GenerateVideoTool returns a video artifact id', async () => {
    const aiDefaults = {
      textToVideo: vi.fn().mockResolvedValue('video-1'),
      imageToVideo: vi.fn().mockResolvedValue('video-2'),
    };
    const defaultsResolution = {};
    const tool = new GenerateVideoTool(
      aiDefaults as any,
      defaultsResolution as any
    );

    const result = await executeTool(tool, {
      inputData: { prompt: 'a cat walking' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(aiDefaults.textToVideo).toHaveBeenCalledWith(org.id, 'a cat walking');
    expect(result).toMatchObject({ id: 'video-1' });
  });

  it('GenerateImageTool generates an image and returns file metadata', async () => {
    const aiDefaults = {
      textToImage: vi.fn().mockResolvedValue('https://example.com/image.png'),
    };
    const storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        writeBuffer: vi.fn().mockResolvedValue('/uploads/image.png'),
      }),
    };
    const fileService = {
      saveFile: vi.fn().mockResolvedValue({
        id: 'file-1',
        path: '/uploads/image.png',
      }),
    };
    const tool = new GenerateImageTool(
      aiDefaults as any,
      fileService as any,
      storageService as any
    );

    const result = await executeTool(tool, {
      inputData: { prompt: 'a red apple' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(aiDefaults.textToImage).toHaveBeenCalledWith(org.id, 'a red apple');
    expect(result).toMatchObject({ id: 'file-1', path: '/uploads/image.png' });
  });

  it('UploadFromUrlTool fetches a URL and returns a saved file', async () => {
    vi.mocked(fromBuffer).mockResolvedValue({ ext: 'png', mime: 'image/png' });

    const storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        uploadFile: vi.fn().mockResolvedValue({
          originalname: 'upload.png',
          path: '/uploads/upload.png',
        }),
      }),
    };
    const fileService = {
      saveFile: vi.fn().mockResolvedValue({
        id: 'file-2',
        path: '/uploads/upload.png',
      }),
    };
    const tool = new UploadFromUrlTool(fileService as any, storageService as any);

    const result = await executeTool(tool, {
      inputData: { url: 'https://example.com/image.png' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(storageService.getLocalAdapterForOrg).toHaveBeenCalledWith(org.id, true);
    expect(result).toMatchObject({ id: 'file-2', path: '/uploads/upload.png' });
  });

  it('UploadFromUrlTool denies without an access context', async () => {
    const tool = new UploadFromUrlTool({} as any, {} as any);

    await expect(
      executeTool(tool, {
        inputData: { url: 'https://example.com/image.png' },
        organization: org,
        user,
        // no access seed → deny-by-default
      })
    ).rejects.toThrow(/Write access denied/);
  });

  it('UploadFromUrlTool denies a headless run', async () => {
    const tool = new UploadFromUrlTool({} as any, {} as any);

    await expect(
      executeTool(tool, {
        inputData: { url: 'https://example.com/image.png' },
        organization: org,
        user,
        access: { mode: 'headless' },
      })
    ).rejects.toThrow(/Write access denied/);
  });

  it('DesignerDesignTool creates a blank image design and returns metadata', async () => {
    const designerDocService = new DesignerDocService();
    const designService = {
      instantiateTemplate: vi.fn(),
      createDesign: vi.fn().mockResolvedValue({ id: 'design-1' }),
      updateDesign: vi.fn(),
    };
    const designRenderService = {
      renderPage: vi.fn().mockResolvedValue(Buffer.from('png')),
    };
    const storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        writeBuffer: vi.fn().mockResolvedValue('/uploads/preview.png'),
      }),
    };
    const fileService = {
      saveFile: vi.fn().mockResolvedValue({
        id: 'file-3',
        path: '/uploads/preview.png',
      }),
    };
    const tool = new DesignerDesignTool(
      designerDocService,
      designService as any,
      designRenderService as any,
      storageService as any,
      fileService as any
    );

    const result = await executeTool(tool, {
      inputData: { name: 'Test design' },
      organization: org,
      user,
      access: { mode: 'user' },
    });

    expect(designService.createDesign).toHaveBeenCalled();
    expect(result).toMatchObject({
      designId: 'design-1',
      previewFileId: 'file-3',
      previewUrl: '/uploads/preview.png',
    });
  });
});
