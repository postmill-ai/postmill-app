// Replicate Media Studio — Cost Estimation
// PRICE_MAP holds flat OUTPUT prices for OFFICIAL_MODELS only.
// For per-second (usage-based) models it returns { approximate: true, basis: 'usage-based' }.

import { OFFICIAL_MODELS } from './replicate-catalog.allowlist';

interface PriceEntry {
  kind: 'per-image' | 'per-video-sec' | 'per-audio-sec' | 'per-1k-char' | 'per-run';
  usd: number;
}

export const PRICE_MAP: Record<string, PriceEntry> = {
  'black-forest-labs/flux-schnell': { kind: 'per-image', usd: 0.003 },
  'black-forest-labs/flux-dev': { kind: 'per-image', usd: 0.025 },
  'black-forest-labs/flux-1.1-pro': { kind: 'per-image', usd: 0.04 },
  'google/imagen-4': { kind: 'per-image', usd: 0.10 },
  'ideogram-ai/ideogram-v3-turbo': { kind: 'per-image', usd: 0.08 },
  'stability-ai/stable-diffusion-3.5-large': { kind: 'per-image', usd: 0.06 },
  'black-forest-labs/flux-kontext-pro': { kind: 'per-image', usd: 0.05 },
  'bria/remove-background': { kind: 'per-image', usd: 0.002 },
  'recraft-ai/recraft-crisp-upscale': { kind: 'per-image', usd: 0.05 },
  'black-forest-labs/flux-fill-pro': { kind: 'per-image', usd: 0.05 },
  'google/veo-3': { kind: 'per-video-sec', usd: 0.50 },
  'minimax/video-01': { kind: 'per-video-sec', usd: 0.30 },
  'bytedance/seedance-1-pro': { kind: 'per-video-sec', usd: 0.40 },
  'kwaivgi/kling-v2.1': { kind: 'per-video-sec', usd: 0.35 },
  'topazlabs/video-upscale': { kind: 'per-run', usd: 0.25 },
  'minimax/speech-02-hd': { kind: 'per-run', usd: 0.05 },
  'minimax/voice-cloning': { kind: 'per-run', usd: 0.10 },
};

export interface EstimateResult {
  usd: number;
  basis: string;
  approximate: boolean;
}

/**
 * Estimate cost for a model given its input.
 * For models in PRICE_MAP, computes a real dollar figure.
 * For community/usage-based models, returns an approximate zero with usage-based basis.
 */
export function estimate(modelId: string, input?: Record<string, unknown>): EstimateResult {
  const entry = PRICE_MAP[modelId];

  if (!entry) {
    return { usd: 0, basis: 'usage-based', approximate: true };
  }

  let multiplier = 1;

  switch (entry.kind) {
    case 'per-image': {
      const numOutputs = typeof input?.num_outputs === 'number' ? input.num_outputs : 1;
      multiplier = Math.max(1, numOutputs);
      break;
    }
    case 'per-video-sec': {
      const duration = typeof input?.duration === 'number' ? input.duration : 5;
      multiplier = Math.max(1, duration);
      break;
    }
    case 'per-audio-sec': {
      const duration = typeof input?.duration === 'number' ? input.duration : 10;
      multiplier = Math.max(1, duration);
      break;
    }
    case 'per-1k-char': {
      const text = typeof input?.text === 'string' ? input.text : '';
      multiplier = Math.max(1, Math.ceil(text.length / 1000));
      break;
    }
    case 'per-run':
    default:
      multiplier = 1;
      break;
  }

  return {
    usd: Math.round(entry.usd * multiplier * 10000) / 10000,
    basis: entry.kind,
    approximate: false,
  };
}

/**
 * Returns whether a model has known output pricing (i.e., is in PRICE_MAP).
 * This is a subset of OFFICIAL_MODELS — some official models may not have
 * documented prices yet.
 */
export function hasPrice(modelId: string): boolean {
  return modelId in PRICE_MAP;
}

/**
 * Returns the pricing category string for display:
 * 'output' = flat output-priced
 * 'usage' = usage-based (per-second community models)
 */
export function pricingCategory(modelId: string): 'output' | 'usage' {
  return modelId in PRICE_MAP ? 'output' : 'usage';
}

/**
 * Returns the real price entry for a model, or null when unknown.
 */
export function getPrice(modelId: string): PriceEntry | null {
  return PRICE_MAP[modelId] || null;
}

import { Injectable } from '@nestjs/common';

@Injectable()
export class ReplicateCostService {
  estimate(modelId: string, input?: Record<string, unknown>): EstimateResult {
    return estimate(modelId, input);
  }

  hasPrice(modelId: string): boolean {
    return hasPrice(modelId);
  }

  pricingCategory(modelId: string): 'output' | 'usage' {
    return pricingCategory(modelId);
  }

  getPrice(modelId: string): PriceEntry | null {
    return getPrice(modelId);
  }
}
