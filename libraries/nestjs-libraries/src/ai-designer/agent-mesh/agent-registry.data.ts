/**
 * Bundled AI Designer agent registry (agent-mesh v-next, in-process transport).
 *
 * Registry entries live in TypeScript — not a YAML asset — so the compiled
 * backend needs no file-system read at boot (`nest build` copies no assets,
 * so a YAML in `dist/` would not exist). Each agent's handler is registered
 * via `registerInProcessAgent` in its own service `OnModuleInit`.
 *
 * `AI_DESIGNER_AGENT_REGISTRY` can still point at a directory of per-agent
 * YAML files to override this registry at runtime (one agent per file, the
 * `@reaatech/agent-mesh-registry` format).
 */
export const AI_DESIGNER_AGENTS = [
  {
    agent_id: 'conversationalist',
    display_name: 'Conversationalist',
    description:
      'The user-facing voice: greet, elicit intent with interactive forms, ' +
      'narrate progress, and interpret natural-language revision requests.',
    type: 'inprocess' as const,
    is_default: true,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'What would you like designed today?',
      'Make the headline bigger and funnier.',
      'I want a meme for Instagram.',
    ],
  },
  {
    agent_id: 'art-director',
    display_name: 'Art Director',
    description:
      'Creative planning. Converts a brief into a Design Plan (layout, ' +
      'palette, typography, per-channel outputs, copy slots, asset needs) ' +
      'and routes to the right design-genre skill.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Plan a product promo for IG square + story.',
      'Choose the meme genre and layout template.',
    ],
  },
  {
    agent_id: 'copywriter',
    display_name: 'Copywriter',
    description:
      'Writes on-brand headline, body, and CTA copy per output slot based ' +
      'on the Design Plan and genre tone.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Write a punchy headline for the hero image.',
      'Generate bottom caption text for a meme.',
    ],
  },
  {
    agent_id: 'asset',
    display_name: 'Asset',
    description:
      "Sources or generates imagery. Uses the tenant's media provider for " +
      'text-to-image, falls back to stock search, then solid/gradient.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Generate a hero image of a summer drink.',
      'Find a stock photo of a city skyline.',
    ],
  },
  {
    agent_id: 'composer',
    display_name: 'Composer',
    description:
      'Drives the Designer. Converts plan+copy+assets into validated ' +
      'DesignerDocOp[] using server-side seed/reflow and linked-by-default ' +
      'elements.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Build the DesignerDoc for variant A.',
      'Apply the Vision Critic fix to the story output.',
    ],
  },
  {
    agent_id: 'vision-critic',
    display_name: 'Vision Critic',
    description:
      'Reviews rendered contact sheets and reference images. Produces typed ' +
      'findings with geometry/style/text fixes or freeform notes.',
    type: 'inprocess' as const,
    is_default: false,
    confidence_threshold: 0,
    clarification_required: false,
    examples: [
      'Check the contact sheet for safe-zone overflows.',
      'Read the brand reference image for palette cues.',
    ],
  },
];
