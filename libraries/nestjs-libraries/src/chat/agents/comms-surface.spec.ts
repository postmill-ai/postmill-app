import { describe, it, expect } from 'vitest';
import { RequestContext } from '@mastra/core/di';
import { isCommsSurface, specialistCommsRules } from './comms-surface';
import { OpsAgentBuilder, OPS_TOOL_NAMES } from './ops.agent';
import { MediaAgentBuilder, MEDIA_TOOL_NAMES } from './media.agent';
import { ContentAgentBuilder, CONTENT_TOOL_NAMES } from './content.agent';

const ctx = (ui: string, access?: object) => {
  const rc = new RequestContext<any>();
  rc.set('ui', ui);
  if (access) rc.set('access', JSON.stringify(access));
  return rc;
};

describe('comms surface for specialists', () => {
  it('is detected only for comms turns without a UI', () => {
    expect(isCommsSurface(ctx('false', { mode: 'comms' }))).toBe(true);
    expect(isCommsSurface(ctx('true', { mode: 'user' }))).toBe(false);
    expect(isCommsSurface(ctx('false', { mode: 'mcp', scopes: [] }))).toBe(false);
    expect(isCommsSurface(ctx('false', { mode: 'headless' }))).toBe(false);
    expect(isCommsSurface(ctx('false'))).toBe(false);
    expect(isCommsSurface(undefined)).toBe(false);
  });

  it('tells specialists not to pre-ask and how to relay a parked action', () => {
    const rules = specialistCommsRules(ctx('false', { mode: 'comms' }));
    expect(rules).toContain('Do NOT ask the user for confirmation before calling an outward tool');
    expect(rules).toContain('needsConfirmation: true');
    expect(specialistCommsRules(ctx('true', { mode: 'user' }))).toBe('');
  });

  it.each([
    ['ops', OpsAgentBuilder, OPS_TOOL_NAMES],
    ['media', MediaAgentBuilder, MEDIA_TOOL_NAMES],
    ['content', ContentAgentBuilder, CONTENT_TOOL_NAMES],
  ])('%s specialist instructions are surface-aware', async (_n, Builder: any, names: string[]) => {
    const aiModelProvider = { languageModel: () => ({}) } as any;
    const tools = Object.fromEntries(names.map((n) => [n, { id: n }]));
    const agent = new Builder(aiModelProvider).agent(tools);
    const comms = await agent.getInstructions({ requestContext: ctx('false', { mode: 'comms' }) });
    const ui = await agent.getInstructions({ requestContext: ctx('true', { mode: 'user' }) });
    expect(String(comms)).toContain('Chat-app surface');
    expect(String(ui)).not.toContain('Chat-app surface');
    expect(String(ui)).toContain('Postmill'); // base instructions intact
  });
});
