import { CHANNEL_PRESETS } from '@postmill-ai/nestjs-libraries/integrations/social/channel-presets';

/** Minimal shape of a designer output (variant) the channel mapping needs. */
export interface ExportVariantLike {
  id: string;
  formatId: string;
}

/** Minimal shape of an exported file the grouping needs. */
export interface ExportedFileLike {
  outputId: string;
}

/**
 * Variant (design output) → social provider, via the shared channel presets.
 * Custom formats carry `provider: null` — they export to /files but are never
 * postable, so they map to null here.
 */
export const providerForFormatId = (formatId: string | undefined): string | null => {
  if (!formatId) return null;
  return CHANNEL_PRESETS.find((p) => p.id === formatId)?.provider ?? null;
};

/**
 * Distinct providers across all variants of a design, in first-appearance
 * order. Used to filter the channel picker down to channels the design can
 * actually be posted to.
 */
export const variantProviders = (outputs: ExportVariantLike[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const output of outputs) {
    const provider = providerForFormatId(output.formatId);
    if (provider && !seen.has(provider)) {
      seen.add(provider);
      result.push(provider);
    }
  }
  return result;
};

/**
 * Group exported files by their variant's provider — every variant of one
 * provider attaches to that provider's draft post. Files whose variant maps
 * to no provider (custom formats, or an output missing from the list) are
 * dropped: they were saved to /files but can't be attached to any channel.
 */
export const groupFilesByProvider = <T extends ExportedFileLike>(
  files: T[],
  outputs: ExportVariantLike[]
): Record<string, T[]> => {
  const providerByOutputId = new Map(
    outputs.map((o) => [o.id, providerForFormatId(o.formatId)])
  );
  const groups: Record<string, T[]> = {};
  for (const file of files) {
    const provider = providerByOutputId.get(file.outputId);
    if (!provider) continue;
    (groups[provider] ||= []).push(file);
  }
  return groups;
};
