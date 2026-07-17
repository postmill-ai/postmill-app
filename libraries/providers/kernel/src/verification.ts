import { ProviderDomain } from './identity';

// Live-key verification status (ENHANCEMENTS_3 workstream E).
//
// A set of media/contentpack adapters were authored "source-grounded" — their request
// shapes and poll/parse logic were written against published API docs/SDK source, but
// never exercised against a real API key. The B4 recorded-fixture int-specs give us
// *request-shape regression* coverage, but they do NOT prove the shape matches a live
// endpoint. So `verified` here means **validated against a live key**, which this cohort
// still lacks — they surface a "Beta" badge in the settings UI until smoke-tested.
//
// Keys are `domain/providerId` (version-agnostic). Membership is intentionally narrow:
// only the documented "built without a live key" media + content-pack providers.
export const BETA_PROVIDER_KEYS: ReadonlySet<string> = new Set<string>([
  // Media — bespoke own-key studios built without a live key
  'media/wan',
  'media/higgsfield',
  'media/ltx',
  'media/reelfarm',
  'media/genviral',
  'media/google', // Google AI Studio (registry id `google`)
  'media/leonardo',
  'media/recraft',
  'media/ideogram',
  'media/vertex', // Veo/Imagen
  'media/qwen', // DashScope
  'media/did',
  'media/hedra',
  'media/tavus',
  'media/suno', // sunoapi.org music — built without a live key
  'media/fal', // Pika tabs
  // Media — AI-hub aggregators serving media via reused AI keys
  'media/togetherai',
  'media/siliconflow',
  'media/groq',
  'media/openrouter',
  'media/fireworks',
  'media/deepinfra',
  'media/gateway',
  'media/bedrock',
  'media/azure',
  // Content packs — premium BYOK, built without a live key
  'contentpack/vecteezy',
  'contentpack/envato',
  'contentpack/adobe-stock',
  'contentpack/magnific',
]);

/**
 * True when a provider is validated against a live key (i.e. NOT in the beta cohort).
 * Drives the catalog `verified` field and the settings "Beta" badge.
 */
export function isProviderVerified(
  domain: ProviderDomain,
  providerId: string
): boolean {
  return !BETA_PROVIDER_KEYS.has(`${domain}/${providerId}`);
}
