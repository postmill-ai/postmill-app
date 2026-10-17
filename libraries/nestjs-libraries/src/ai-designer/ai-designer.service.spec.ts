import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AiDesignerService, deriveSessionFormat } from './ai-designer.service';

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'sess-1';

const makeService = (overrides: {
  session?: any;
  designDoc?: any;
  purgeError?: Error;
} = {}) => {
  const sessionRepo = {
    create: vi.fn().mockImplementation(async (data: any) => ({ id: SESSION_ID, ...data })),
    findByIdForOrgAndUser: vi
      .fn()
      .mockResolvedValue(
        overrides.session === undefined
          ? {
              id: SESSION_ID,
              config: { referenceFileIds: ['ref-1', 'lib-1'] },
              activeDesignIds: ['design-1'],
            }
          : overrides.session
      ),
    delete: vi.fn().mockResolvedValue({ id: SESSION_ID }),
  };
  const messageRepo = { clearSeq: vi.fn().mockResolvedValue(undefined) };
  const guardrails = { checkInput: vi.fn() };
  const fileService = {
    purgeAiDesignerSessionFiles: overrides.purgeError
      ? vi.fn().mockRejectedValue(overrides.purgeError)
      : vi.fn().mockResolvedValue(1),
  };
  const designService = {
    getDesign: vi.fn().mockResolvedValue({
      id: 'design-1',
      doc: overrides.designDoc ?? {
        outputs: [
          {
            children: [
              { type: 'image', fileId: 'kept-1', src: '/uploads/kept-1.png' },
            ],
          },
        ],
      },
    }),
  };
  return {
    service: new AiDesignerService(
      sessionRepo as any,
      messageRepo as any,
      guardrails as any,
      fileService as any,
      designService as any
    ),
    sessionRepo,
    messageRepo,
    fileService,
    designService,
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AiDesignerService.deleteSession intermediate purge', () => {
  it('purges intermediates, keeping the files delivered designs reference', async () => {
    const { service, fileService } = makeService();

    await service.deleteSession(SESSION_ID, ORG_ID, USER_ID);

    expect(fileService.purgeAiDesignerSessionFiles).toHaveBeenCalledWith(
      ORG_ID,
      SESSION_ID,
      {
        referenceFileIds: ['ref-1', 'lib-1'],
        keepFileIds: new Set(['kept-1']),
      }
    );
  });

  it('still deletes the session when the purge fails (best-effort)', async () => {
    const { service, sessionRepo, messageRepo } = makeService({
      purgeError: new Error('db down'),
    });

    const result = await service.deleteSession(SESSION_ID, ORG_ID, USER_ID);

    expect(result).toEqual({ id: SESSION_ID });
    expect(sessionRepo.delete).toHaveBeenCalledWith(SESSION_ID, ORG_ID, USER_ID);
    expect(messageRepo.clearSeq).toHaveBeenCalledWith(SESSION_ID);
  });

  it('skips the purge when the session row is gone', async () => {
    const { service, fileService } = makeService({ session: null });

    await service.deleteSession(SESSION_ID, ORG_ID, USER_ID);

    expect(fileService.purgeAiDesignerSessionFiles).not.toHaveBeenCalled();
  });

  it('tolerates sessions with no config references and no active designs', async () => {
    const { service, fileService, designService } = makeService({
      session: { id: SESSION_ID, config: {}, activeDesignIds: null },
    });

    await service.deleteSession(SESSION_ID, ORG_ID, USER_ID);

    expect(designService.getDesign).not.toHaveBeenCalled();
    expect(fileService.purgeAiDesignerSessionFiles).toHaveBeenCalledWith(
      ORG_ID,
      SESSION_ID,
      { referenceFileIds: [], keepFileIds: new Set() }
    );
  });
});

describe('deriveSessionFormat', () => {
  const base = { variants: 1 };

  it('is image for image presets and custom sizes', () => {
    expect(
      deriveSessionFormat({ ...base, channels: ['ig-post', 'fb-post'] })
    ).toBe('image');
    expect(
      deriveSessionFormat({
        ...base,
        channels: [],
        customSizes: [{ width: 500, height: 500 }],
      })
    ).toBe('image');
    // ig-reel/tiktok are category 'story' (image surfaces) — only the
    // category 'video' presets make a video session.
    expect(deriveSessionFormat({ ...base, channels: ['ig-reel'] })).toBe(
      'image'
    );
  });

  it('is video when every channel is a video preset', () => {
    expect(
      deriveSessionFormat({ ...base, channels: ['reel', 'short'] })
    ).toBe('video');
    expect(deriveSessionFormat({ ...base, channels: ['tiktok-video'] })).toBe(
      'video'
    );
  });

  it('rejects mixed image+video selections', () => {
    expect(() =>
      deriveSessionFormat({ ...base, channels: ['ig-post', 'reel'] })
    ).toThrow(BadRequestException);
    expect(() =>
      deriveSessionFormat({
        ...base,
        channels: ['reel'],
        customSizes: [{ width: 500, height: 500 }],
      })
    ).toThrow(BadRequestException);
  });
});

describe('AiDesignerService.createSession format', () => {
  it('persists the derived format on the session row', async () => {
    const { service, sessionRepo } = makeService();

    await service.createSession({
      organizationId: ORG_ID,
      userId: USER_ID,
      mode: 'prompt',
      config: { channels: ['reel'], variants: 1 },
    });

    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'video' })
    );
  });

  it('defaults to image for non-video selections', async () => {
    const { service, sessionRepo } = makeService();

    await service.createSession({
      organizationId: ORG_ID,
      userId: USER_ID,
      mode: 'prompt',
      config: { channels: ['ig-post'], variants: 1 },
    });

    expect(sessionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'image' })
    );
  });

  it('rejects a mixed selection before a row is created', async () => {
    const { service, sessionRepo } = makeService();

    await expect(
      service.createSession({
        organizationId: ORG_ID,
        userId: USER_ID,
        mode: 'prompt',
        config: { channels: ['ig-post', 'reel'], variants: 1 },
      })
    ).rejects.toThrow(BadRequestException);
    expect(sessionRepo.create).not.toHaveBeenCalled();
  });
});
