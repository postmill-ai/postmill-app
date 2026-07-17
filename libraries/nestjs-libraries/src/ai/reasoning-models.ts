/** Known reasoning-capable model IDs (case-insensitive prefix match) */
export const REASONING_MODEL_PREFIXES = [
  'o1', 'o3',           // OpenAI o-series
  'claude-3-opus',      // Claude extended thinking
  'deepseek-reasoner',  // DeepSeek R1
  'gemini-2.5-pro',     // Gemini 2.5 thinking
  'sonar-reasoning',    // Perplexity
  'qwq',                // Qwen reasoning
  'grok-3-reasoning',   // Grok
  'gpt-5-reasoning',    // Future OpenAI
];

export function isReasoningModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  return REASONING_MODEL_PREFIXES.some(prefix => id.startsWith(prefix));
}
