import { z } from 'zod';

/**
 * Runtime schema for AnalyticsShare.config.
 * Rejects unknown keys on write.
 */
export const AnalyticsShareConfigSchema = z
  .object({
    integrations: z.array(z.string()).optional(),
    rangePreset: z.enum(['7d', '30d', '90d']).optional(),
  })
  .strict();

export type AnalyticsShareConfig = z.infer<typeof AnalyticsShareConfigSchema>;

/**
 * Validate and coerce a public-share config payload.
 * Throws a ZodError on unknown keys or invalid shapes.
 */
export function validateAnalyticsShareConfig(
  data: unknown,
): AnalyticsShareConfig {
  return AnalyticsShareConfigSchema.parse(data);
}
