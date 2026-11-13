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
    expect(service.updateSession).toHaveBeenCalledWith(
      SESSION_ID,
      ORG_ID,
      USER_ID,
      expect.objectContaining({
        config: expect.objectContaining({
          referenceFileIds: ['image-1'],
          attachmentFileIds: ['doc-1'],
        }),
        brief: expect.objectContaining({ documentContexts }),
      })
    );
    expect((conductor as any)._attachments.contextsFor).toHaveBeenCalledTimes(1);
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

  it('prepares start attachments read-only and reuses them without a second extraction', async () => {
    const { conductor, service } = makeConductor(intakeSession(), ownedFiles());
    const documentContexts = [
      { fileId: 'doc-1', name: 'brief.txt', text: 'Launch next Friday' },
    ];
    (conductor as any)._attachments = {
      contextsFor: vi.fn().mockResolvedValue(documentContexts),
    };
    (conductor as any)._runPromptMode = vi.fn().mockResolvedValue(undefined);
    const context = { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID };
    const config = {
      ...intakeSession().config,
      referenceFileIds: ['image-1'],
      attachmentFileIds: ['doc-1'],
    } as any;

    const prepared = await conductor.validateAttachmentConfig(
      context,
      config,
      config,
      { intent: 'Create' }
    );
    expect(service.updateSession).not.toHaveBeenCalled();

    await conductor.handleStart(
      SESSION_ID,
      context,
      config,
      'Create',
      emitter(),
      'prompt',
      prepared
    );

    expect((conductor as any)._attachments.contextsFor).toHaveBeenCalledTimes(1);
    expect(service.updateSession).not.toHaveBeenCalled();
    expect((conductor as any)._runPromptMode).toHaveBeenCalledWith(
      SESSION_ID,
      context,
      config,
      'Create',
      expect.anything(),
      documentContexts
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

  it('rejects cross-org references on explicit revise before acknowledgement or writes', async () => {
    const fileService = { getFileById: vi.fn().mockResolvedValue(null) };
    const { conductor, service } = makeConductor(
      { ...intakeSession(), state: 'awaiting_plan' },
      fileService
    );
    const onAccepted = vi.fn();

    await expect(conductor.handleRevise(
      SESSION_ID,
      { orgId: 'org-2', userId: USER_ID, sessionId: SESSION_ID },
      {
        instruction: 'Use this reference',
        referenceFileIds: ['image-foreign'],
        nonce: 'nonce-foreign',
      },
      emitter(),
      onAccepted
    )).rejects.toBeInstanceOf(BadRequestException);

    expect(fileService.getFileById).toHaveBeenCalledWith('org-2', 'image-foreign');
    expect(onAccepted).not.toHaveBeenCalled();
    expect(service.updateSession).not.toHaveBeenCalled();
  });

  it('rejects a busy intake turn before attachment validation, persistence, or acknowledgement', async () => {
    const fileService = ownedFiles();
    const { conductor, service } = makeConductor(intakeSession(), fileService);
    (conductor as any)._inFlight.add(SESSION_ID);
    const onAccepted = vi.fn();

    await expect(conductor.handleMessage(
      SESSION_ID,
      { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID },
      'Use these files',
      emitter(),
      { referenceFileIds: ['image-1'], attachmentFileIds: ['doc-1'] },
      onAccepted
    )).rejects.toMatchObject({ name: 'AiDesignerBusyError' });

    expect(fileService.getFileById).not.toHaveBeenCalled();
    expect(service.updateSession).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
  });

  it('reuses cached contexts without new extraction or Brand Knowledge spend and bounds intake', async () => {
    const documentContexts = [{
      fileId: 'doc-1',
      name: 'brief.txt',
      text: 'x'.repeat(20_000),
    }];
    const session = {
      ...intakeSession(),
      config: {
        ...intakeSession().config,
        brandProfileId: 'brand-1',
        attachmentFileIds: ['doc-1'],
      },
      brief: { intent: 'Launch', documentContexts },
    };
    const { conductor } = makeConductor(session, ownedFiles());
    (conductor as any)._attachments = { contextsFor: vi.fn() };
    (conductor as any)._brands = { getBrand: vi.fn() };
    (conductor as any)._rag = { search: vi.fn() };
    (conductor as any)._lastAssistantQuestion = vi.fn().mockResolvedValue(undefined);
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({ type: 'reply', text: 'Got it' }),
    });

    await conductor.handleMessage(
      SESSION_ID,
      { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID },
      'Continue',
      emitter(),
      { referenceFileIds: [], attachmentFileIds: ['doc-1'] },
      vi.fn().mockResolvedValue(undefined)
    );

    expect((conductor as any)._attachments.contextsFor).not.toHaveBeenCalled();
    expect((conductor as any)._rag.search).not.toHaveBeenCalled();
    const intake = (conductor as any)._dispatchAgent.mock.calls[0][2];
    expect(intake.session.brief.documentContexts[0].text).toHaveLength(12_000);
  });

  it('does not start Brand Knowledge searches for an existing session without attachments', async () => {
    const session = {
      ...intakeSession(),
      config: { ...intakeSession().config, brandProfileId: 'brand-1' },
      brief: { intent: 'Launch' },
    };
    const { conductor } = makeConductor(session, ownedFiles());
    (conductor as any)._brands = { getBrand: vi.fn() };
    (conductor as any)._rag = { search: vi.fn() };
    (conductor as any)._lastAssistantQuestion = vi.fn().mockResolvedValue(undefined);
    (conductor as any)._dispatchAgent = vi.fn().mockResolvedValue({
      content: JSON.stringify({ type: 'reply', text: 'Got it' }),
    });

    await conductor.handleMessage(
      SESSION_ID,
      { orgId: ORG_ID, userId: USER_ID, sessionId: SESSION_ID },
      'Continue',
      emitter()
    );

    expect((conductor as any)._brands.getBrand).not.toHaveBeenCalled();
    expect((conductor as any)._rag.search).not.toHaveBeenCalled();
  });
});
