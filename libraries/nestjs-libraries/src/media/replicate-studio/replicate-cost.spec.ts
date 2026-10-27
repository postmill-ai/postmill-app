import { describe, it, expect } from 'vitest';
import { estimate, ReplicateCostService } from './replicate-cost';

describe('Replicate cost estimation', () => {
  it('multiplies per-image price by num_outputs', () => {
    const result = estimate('black-forest-labs/flux-dev', {
      num_outputs: 4,
    });
    expect(result).toMatchObject({
      usd: 0.1,
      basis: 'per-image',
      approximate: false,
    });
  });

  it('defaults per-image multiplier to 1', () => {
    const result = estimate('black-forest-labs/flux-dev');
    expect(result).toMatchObject({
      usd: 0.025,
      basis: 'per-image',
      approximate: false,
    });
  });

  it('returns usage-based approximate pricing for unknown/community models', () => {
    const result = estimate('some-community/model');
    expect(result).toMatchObject({
      usd: 0,
      basis: 'usage-based',
      approximate: true,
    });
  });

  it('prices the veo-3.1 replacement per output second (veo-3 is retired upstream)', () => {
    expect(estimate('google/veo-3.1', { duration: 8 })).toMatchObject({
      usd: 3.2,
      basis: 'per-video-sec',
      approximate: false,
    });
    expect(estimate('google/veo-3')).toMatchObject({ basis: 'usage-based', approximate: true });
  });

  it('uses model-aware duration fallbacks for Veo and Video-01', () => {
    expect(estimate('google/veo-3.1').usd).toBe(3.2);
    expect(estimate('minimax/video-01').usd).toBe(1.8);
    expect(estimate('bytedance/seedance-1-pro').usd).toBe(2);
    expect(estimate('kwaivgi/kling-v2.5-turbo-pro').usd).toBe(0.35);
  });

  it('accepts numeric-string durations when estimating output seconds', () => {
    expect(estimate('google/veo-3.1', { duration: '4' }).usd).toBe(1.6);
  });

  it('prices wan-2.7-videoedit per output second', () => {
    expect(estimate('wan-video/wan-2.7-videoedit', { duration: 10 })).toMatchObject({
      usd: 1,
      basis: 'per-video-sec',
      approximate: false,
    });
  });

  describe('ReplicateCostService', () => {
    it('exposes estimate, hasPrice, pricingCategory, and getPrice', () => {
      const service = new ReplicateCostService();
      expect(service.estimate('black-forest-labs/flux-dev')).toMatchObject({
        usd: 0.025,
      });
      expect(service.hasPrice('black-forest-labs/flux-dev')).toBe(true);
      expect(service.pricingCategory('black-forest-labs/flux-dev')).toBe(
        'output',
      );
      expect(service.getPrice('black-forest-labs/flux-dev')).toMatchObject({
        kind: 'per-image',
        usd: 0.025,
      });
      expect(service.getPrice('unknown/model')).toBeNull();
    });
  });
});
