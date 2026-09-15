import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RequestContext } from '@mastra/core/di';
import { CommsConfirmationGate } from './comms-confirmation.gate';

const makeRedis = () => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => (store.delete(k) ? 1 : 0)),
  };
};

const ctx = (over: Record<string, unknown> = {}) => {
  const rc = new RequestContext<any>();
  const values: Record<string, unknown> = {
    organization: JSON.stringify({ id: 'org-1' }),
    user: JSON.stringify({ id: 'user-1' }),
    ui: 'false',
    access: JSON.stringify({ mode: 'comms' }),
    thread: 'comms:link-1:D1',
    linkId: 'link-1',
    ...over,
  };
  for (const [k, v] of Object.entries(values)) if (v !== undefined) rc.set(k, v as any);
  return { requestContext: rc };
};

const outwardTool = () => ({
  id: 'schedulePostTool',
  mcp: { annotations: { readOnlyHint: false } },
  execute: vi.fn(async (input: any) => ({ output: ['post-1'], echoed: input })),
});

describe('CommsConfirmationGate', () => {
  let redis: ReturnType<typeof makeRedis>;
  let gate: CommsConfirmationGate;

  beforeEach(() => {
    redis = makeRedis();
    gate = new CommsConfirmationGate(redis as any);
  });

  it('returns read-only tools untouched (same reference)', () => {
    const tool = { id: 'integrationList', mcp: { annotations: { readOnlyHint: true } }, execute: vi.fn() };
    expect(gate.wrap('integrationList', tool)).toBe(tool);
  });

  it.each([
    ['user', { mode: 'user' }, 'true'],
    ['mcp', { mode: 'mcp', scopes: ['mcp:posts:write'] }, 'false'],
    ['headless', { mode: 'headless' }, 'false'],
  ])('%s mode passes straight through to the tool', async (_m, access, ui) => {
    const tool = outwardTool();
    const wrapped = gate.wrap('integrationSchedulePostTool', tool);
    const input = { socialPost: [] };
    const result = await wrapped.execute(input, ctx({ access: JSON.stringify(access), ui }));
    expect(tool.execute).toHaveBeenCalledWith(input, expect.anything());
    expect(result).toMatchObject({ output: ['post-1'] });
    expect(redis.set).not.toHaveBeenCalled();
  });

  it('refuses a comms call without a thread and does not execute', async () => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    const result = await wrapped.execute({}, ctx({ thread: undefined }));
    expect(result).toEqual({ error: 'Confirmation gate: no thread in context' });
    expect(tool.execute).not.toHaveBeenCalled();
  });

  it('parks an outward comms call: needsConfirmation shape, Redis record, tool not executed', async () => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    const input = {
      socialPost: [
        { integrationId: 'int-1', date: '2026-09-15T10:00:00Z', type: 'schedule', postsAndComments: [{ content: '<p>hi</p>', attachments: [] }] },
      ],
    };
    const result = await wrapped.execute(input, ctx());
    expect(tool.execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      needsConfirmation: true,
      confirmationId: expect.stringMatching(/^[0-9a-f]{12}$/),
      summary: expect.stringContaining('Schedule on channel int-1'),
      instructions: expect.stringContaining('Reply YES to confirm or NO to cancel'),
    });
    expect(redis.set).toHaveBeenCalledWith('comms:pending:comms:link-1:D1', expect.any(String), 900);
    const stored = JSON.parse(redis.store.get('comms:pending:comms:link-1:D1')!);
    expect(stored).toMatchObject({
      confirmationId: result.confirmationId,
      toolId: 'schedulePostTool',
      args: input,
      orgId: 'org-1',
      userId: 'user-1',
      linkId: 'link-1',
      threadId: 'comms:link-1:D1',
      summary: result.summary,
    });
    expect(stored.expiresAt - stored.createdAt).toBe(900_000);
  });

  it('keeps the same id for a retried identical call and replaces it for different args', async () => {
    const wrapped = gate.wrap('x', outwardTool());
    const a = await wrapped.execute({ socialPost: [{ integrationId: 'a' }] }, ctx());
    const again = await wrapped.execute({ socialPost: [{ integrationId: 'a' }] }, ctx());
    expect(again.confirmationId).toBe(a.confirmationId);
    const b = await wrapped.execute({ socialPost: [{ integrationId: 'b' }] }, ctx());
    expect(b.confirmationId).not.toBe(a.confirmationId);
    expect(JSON.parse(redis.store.get('comms:pending:comms:link-1:D1')!).confirmationId).toBe(b.confirmationId);
  });

  it('runs the tool when the confirmed id matches the action carried in the call context', async () => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    const input = { socialPost: [{ integrationId: 'a' }] };
    const parked = await wrapped.execute(input, ctx());
    const pending = await gate.getPending('comms:link-1:D1');
    // The inbound path clears Redis BEFORE executing; the confirmed run must
    // not depend on the record still being there.
    await gate.clearPending('comms:link-1:D1');
    const result = await wrapped.execute(input, {
      ...ctx({ access: JSON.stringify({ mode: 'comms', confirmed: parked.confirmationId }) }),
      confirmedAction: pending,
    });
    expect(tool.execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ output: ['post-1'] });
  });

  it('a confirmed access id alone (no action in context) never executes', async () => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    const input = { socialPost: [{ integrationId: 'a' }] };
    const parked = await wrapped.execute(input, ctx());
    const result = await wrapped.execute(
      input,
      ctx({ access: JSON.stringify({ mode: 'comms', confirmed: parked.confirmationId }) }),
    );
    expect(tool.execute).not.toHaveBeenCalled();
    expect(result.needsConfirmation).toBe(true);
  });

  it.each([
    ['wrong id', { confirmed: 'deadbeefcafe' }],
    ['no id', {}],
  ])('re-parks instead of executing on %s', async (_l, extra) => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    await wrapped.execute({ socialPost: [{ integrationId: 'a' }] }, ctx());
    const result = await wrapped.execute(
      { socialPost: [{ integrationId: 'a' }] },
      ctx({ access: JSON.stringify({ mode: 'comms', ...extra }) }),
    );
    expect(tool.execute).not.toHaveBeenCalled();
    expect(result.needsConfirmation).toBe(true);
  });

  it('does not let a confirmation for one tool run another', async () => {
    const schedule = outwardTool();
    const del = { id: 'deletePost', mcp: { annotations: { readOnlyHint: false } }, execute: vi.fn() };
    const wrappedSchedule = gate.wrap('x', schedule);
    const wrappedDelete = gate.wrap('y', del);
    const parked = await wrappedSchedule.execute({ socialPost: [] }, ctx());
    const pending = await gate.getPending('comms:link-1:D1');
    const result = await wrappedDelete.execute(
      { group: 'g' },
      { ...ctx({ access: JSON.stringify({ mode: 'comms', confirmed: parked.confirmationId }) }), confirmedAction: pending },
    );
    expect(del.execute).not.toHaveBeenCalled();
    expect(result.needsConfirmation).toBe(true);
  });

  it('treats an expired record as absent and deletes it', async () => {
    redis.store.set(
      'comms:pending:comms:link-1:D1',
      JSON.stringify({ confirmationId: 'old', toolId: 'schedulePostTool', args: {}, expiresAt: Date.now() - 1 }),
    );
    expect(await gate.getPending('comms:link-1:D1')).toBeNull();
    expect(redis.del).toHaveBeenCalledWith('comms:pending:comms:link-1:D1');
  });

  it('executeConfirmed re-invokes the registered wrapped execute with the parked args', async () => {
    const tool = outwardTool();
    const wrapped = gate.wrap('x', tool);
    const parked = await wrapped.execute({ socialPost: [{ integrationId: 'a' }] }, ctx());
    const pending = await gate.getPending('comms:link-1:D1');
    const rc = ctx({ access: JSON.stringify({ mode: 'comms', confirmed: parked.confirmationId }) }).requestContext;
    await gate.clearPending('comms:link-1:D1'); // as the inbound path does
    const result = await gate.executeConfirmed(pending!, rc);
    expect(tool.execute).toHaveBeenCalledWith(
      { socialPost: [{ integrationId: 'a' }] },
      { requestContext: rc, confirmedAction: pending },
    );
    expect(result).toMatchObject({ output: ['post-1'] });
  });

  it('executeConfirmed throws for a tool that was never registered', async () => {
    await expect(
      gate.executeConfirmed({ toolId: 'ghost', args: {} } as any, new RequestContext()),
    ).rejects.toThrow("Confirmation gate: tool 'ghost' not registered");
  });
});
