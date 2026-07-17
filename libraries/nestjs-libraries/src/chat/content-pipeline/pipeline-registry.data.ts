import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';

/**
 * Bundled content-pipeline agent registry (agent-mesh v-next, in-process
 * transport). Entries are TypeScript data, not a YAML asset, so `nest build`
 * does not depend on file-system assets at boot.
 *
 * Individual agents register their in-process handlers in their own services
 * via `registerInProcessAgent` from `@reaatech/agent-mesh-router`.
 */
/**
 * Agent ids are namespaced with a `content-pipeline-` prefix. `registryState`
 * and the in-process `handlers` map in `@reaatech/agent-mesh-*` are process-wide
 * singletons shared with the AI Designer mesh, which also registers a
 * `copywriter` handler. Unique ids keep the two subsystems from clobbering each
 * other's handler entries. (`agent_id` must match `/^[a-z0-9-]+$/`.)
 */
export const CONTENT_PIPELINE_AGENT_IDS = {
  strategist: 'content-pipeline-strategist',
  copywriter: 'content-pipeline-copywriter',
  brandCritic: 'content-pipeline-brand-critic',
  finalizer: 'content-pipeline-finalizer',
} as const;

export const CONTENT_PIPELINE_AGENTS = [
  {
    agent_id: CONTENT_PIPELINE_AGENT_IDS.strategist,
    display_name: 'Strategist',
    description:
      'Turns a brief into a per-platform content plan: platforms, angles, ' +
      'hooks, and structure. Grounded in brand voice and past-post memory.',
    type: 'inprocess' as const,
    is_default: true,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Plan a launch post for LinkedIn and X.',
      'What angles fit our brand for a product update?',
    ],
  },
  {
    agent_id: CONTENT_PIPELINE_AGENT_IDS.copywriter,
    display_name: 'Copywriter',
    description:
      'Writes per-platform copy from a strategist plan, respecting each ' +
      "platform's length and format rules.",
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Write a punchy X post under 280 characters.',
      'Draft a LinkedIn paragraph with a strong CTA.',
    ],
  },
  {
    agent_id: CONTENT_PIPELINE_AGENT_IDS.brandCritic,
    display_name: 'Brand Critic',
    description:
      'Reviews copy against brand voice, do-not-use terms, and platform ' +
      'rules. Returns pass/fail and a short fix list.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Does this copy sound on-brand?',
      'Flag any tone or length issues for LinkedIn.',
    ],
  },
  {
    agent_id: CONTENT_PIPELINE_AGENT_IDS.finalizer,
    display_name: 'Finalizer',
    description:
      'Assembles approved copy into the final tool return shape: a content ' +
      'array, per-platform map, and optional image prompts.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Package the approved copy for the scheduling tool.',
      'Generate image prompts from the chosen angles.',
    ],
  },
];
