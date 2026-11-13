import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AiDesignerConductorService } from './ai-designer-conductor.service';

const ORG_ID = 'org-1';
const USER_ID = 'user-1';
const SESSION_ID = 'session-1';

const makeConductor = (
  session: Record<string, unknown>,
  fileService: { getFileById: ReturnType<typeof vi.fn> }
) => {
  const service = {
    getSessionForUser: vi.fn().mockResolvedValue(session),
    updateSession: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
  };
  const policy = {
    check: vi.fn().mockImplementation((input) => Promise.resolve({
      ok: true,
      values: input.values,
      instruction: input.instruction,
    })),
  };
  const conductor = new AiDesignerConductorService(
    service as any,
    null as any,
    null as any,
    null as any,
    null as any,
    { checkStartBudget: vi.fn().mockResolvedValue({ allowed: true }) } as any,
    fileService as any,
    policy as any,
    null as any
  );
  return { conductor, service };
};

const emitter = () => ({
  toSession: vi.fn(),
  progress: vi.fn(),
  preview: vi.fn(),
  error: vi.fn(),
});

const ownedFiles = () => ({
  getFileById: vi.fn().mockImplementation((_orgId, fileId) =>
    Promise.resolve({
      id: fileId,
      type: fileId.startsWith('image-') ? 'image' : 'document',
    })
  ),
});

const intakeSession = () => ({
  id: SESSION_ID,
  state: 'intake',
  mode: 'chat',
  config: { channels: ['ig-post'], variants: 1 },
  brief: { intent: '' },
  activeDesignIds: null,
});

describe('AI Designer attachment intake and revision', () => {
  it('merges owned IDs before acknowledgement and injects document context into chat intake', async () => {
    const fileService = ownedFiles();
    const { conductor, service } = makeConductor(intakeSession(), fileService);
    const documentContexts = [
      { fileId: 'doc-1', name: 'brief.txt', text: 'Launch next Friday' },
    ];
    (conductor as any)._attachments = {
      contextsFor: vi.fn().mockResolvedValue(documentContexts),
    };
    (conductor as any)._lastAssistantQuestion = vi.fn().mockResolvedValue(undefined);
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({ type: 'reply', text: 'Got it' }),
    });
    const onAccepted = vi.fn().mockResolvedValue(undefined);
    const context = { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID };

    await conductor.handleMessage(
      SESSION_ID,
      context,
      'Use the attached launch date',
      emitter(),
      { referenceFileIds: ['image-1'], attachmentFileIds: ['doc-1'] },
      onAccepted
    );

    expect(fileService.getFileById).toHaveBeenCalledWith(ORG_ID, 'image-1');
    expect(fileService.getFileById).toHaveBeenCalledWith(ORG_ID, 'doc-1');
    expect(onAccepted).toHaveBeenCalledOnce();
    expect(service.updateSession).toHaveBeenCalledWith(SESSION_ID, ORG_ID, USER_ID, {
      config: expect.objectContaining({
        referenceFileIds: ['image-1'],
        attachmentFileIds: ['doc-1'],
      }),
    });
    expect((conductor as any)._dispatchAgent).toHaveBeenCalledWith(
      context,
      'conversationalist',
      expect.objectContaining({
        session: expect.objectContaining({
          brief: expect.objectContaining({ documentContexts }),
        }),
      })
    );
  });

  it('rejects second-org file IDs before acknowledgement or agent dispatch', async () => {
    const fileService = { getFileById: vi.fn().mockResolvedValue(null) };
    const { conductor, service } = makeConductor(intakeSession(), fileService);
    (conductor as any)._dispatchAgent = vi.fn();
    const onAccepted = vi.fn();

    await expect(conductor.handleMessage(
      SESSION_ID,
      { orgId: 'org-2', userId: USER_ID, sessionId: SESSION_ID },
      'Use this other workspace file',
      emitter(),
      { referenceFileIds: ['image-foreign'] },
      onAccepted
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(fileService.getFileById).toHaveBeenCalledWith('org-2', 'image-foreign');
    expect(onAccepted).not.toHaveBeenCalled();
    expect(service.updateSession).not.toHaveBeenCalled();
    expect((conductor as any)._dispatchAgent).not.toHaveBeenCalled();
  });

  it('does not merge new attachment config in an unsupported state without acceptance', async () => {
    const fileService = ownedFiles();
    const { conductor, service } = makeConductor(
      {
        ...intakeSession(),
        state: 'executing',
        config: {
          channels: ['ig-post'],
          variants: 1,
          referenceFileIds: ['image-old'],
        },
      },
      fileService
    );
    const onAccepted = vi.fn();

    await conductor.handleRevise(
      SESSION_ID,
      { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID },
      {
        instruction: 'Use a new reference',
        referenceFileIds: ['image-new'],
        nonce: 'nonce-1',
      },
      emitter(),
      onAccepted
    );

    expect(onAccepted).not.toHaveBeenCalled();
    expect(service.updateSession).not.toHaveBeenCalled();
  });

  it('forwards both ID lists through delivered free-text revision', async () => {
    const { conductor } = makeConductor(
      {
        ...intakeSession(),
        state: 'delivered',
        activeDesignIds: ['design-1'],
      },
      ownedFiles()
    );
    const revise = vi.fn().mockResolvedValue(undefined);
    (conductor as any).handleRevise = revise;
    const onAccepted = vi.fn();
    const context = { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID };

    await conductor.handleMessage(
      SESSION_ID,
      context,
      'Use these files',
      emitter(),
      { referenceFileIds: ['image-1'], attachmentFileIds: ['doc-1'] },
      onAccepted
    );

    expect(revise).toHaveBeenCalledWith(
      SESSION_ID,
      context,
      expect.objectContaining({
        targetDesignId: 'design-1',
        referenceFileIds: ['image-1'],
        attachmentFileIds: ['doc-1'],
      }),
      expect.anything(),
      onAccepted
    );
  });
});
