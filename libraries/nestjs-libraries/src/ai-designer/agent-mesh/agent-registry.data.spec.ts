import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { describe, expect, it } from 'vitest';
import { AgentRegistrySchema } from '@reaatech/agent-mesh-registry';
import { AI_DESIGNER_AGENTS } from './agent-registry.data';

// The bundled registry is the boot-time default (no YAML asset survives
// `nest build`). If this data ever drifts from the agent-mesh schema, the
// mesh module logs a degraded-boot error in production — catch it here.
describe('AI_DESIGNER_AGENTS bundled registry', () => {
  it('validates against AgentRegistrySchema', () => {
    const parsed = AgentRegistrySchema.safeParse(AI_DESIGNER_AGENTS);
    expect(parsed.success).toBe(true);
  });

  it('contains the six pipeline agents with exactly one default', () => {
    const ids = AI_DESIGNER_AGENTS.map((a) => a.agent_id);
    expect(ids).toEqual([
      'conversationalist',
      'art-director',
      'copywriter',
      'asset',
      'composer',
      'vision-critic',
    ]);
    expect(AI_DESIGNER_AGENTS.filter((a) => a.is_default)).toHaveLength(1);
    expect(AI_DESIGNER_AGENTS.every((a) => a.type === 'inprocess')).toBe(true);
  });
});
