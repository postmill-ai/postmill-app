import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { describe, expect, it } from 'vitest';
import { AgentRegistrySchema } from '@reaatech/agent-mesh-registry';
import {
  CONTENT_PIPELINE_AGENTS,
  CONTENT_PIPELINE_AGENT_IDS,
} from './pipeline-registry.data';

describe('CONTENT_PIPELINE_AGENTS bundled registry', () => {
  it('validates against AgentRegistrySchema', () => {
    const parsed = AgentRegistrySchema.safeParse(CONTENT_PIPELINE_AGENTS);
    expect(parsed.success).toBe(true);
  });

  it('contains the four pipeline agents with exactly one default', () => {
    const ids = CONTENT_PIPELINE_AGENTS.map((a) => a.agent_id);
    expect(ids).toEqual([
      CONTENT_PIPELINE_AGENT_IDS.strategist,
      CONTENT_PIPELINE_AGENT_IDS.copywriter,
      CONTENT_PIPELINE_AGENT_IDS.brandCritic,
      CONTENT_PIPELINE_AGENT_IDS.finalizer,
    ]);
    // Ids are namespaced to avoid colliding with the AI Designer mesh handlers.
    expect(ids.every((id) => id.startsWith('content-pipeline-'))).toBe(true);
    expect(CONTENT_PIPELINE_AGENTS.filter((a) => a.is_default)).toHaveLength(1);
    expect(
      CONTENT_PIPELINE_AGENTS.every((a) => a.type === 'inprocess')
    ).toBe(true);
  });
});
