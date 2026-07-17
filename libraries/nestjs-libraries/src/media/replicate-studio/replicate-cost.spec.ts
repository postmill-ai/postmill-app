import { describe, it, expect } from 'vitest';
import { estimate, ReplicateCostService } from './replicate-cost';

describe('Replicate cost estimation', () => {
  it('multiplies per-image price by num_outputs', () => {
    const result = estimate('black-forest-labs/flux-schnell', {
      num_outputs: 4,
    });
    expect(result).toMatchObject({
      usd: 0.012,
      basis: 'per-image',
      approximate: false,
    });
  });

  it('defaults per-image multiplier to 1', () => {
    const result = estimate('black-forest-labs/flux-schnell');
    expect(result).toMatchObject({
      usd: 0.003,
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

  describe('ReplicateCostService', () => {
    it('exposes estimate, hasPrice, pricingCategory, and getPrice', () => {
      const service = new ReplicateCostService();
      expect(service.estimate('black-forest-labs/flux-schnell')).toMatchObject({
        usd: 0.003,
      });
      expect(service.hasPrice('black-forest-labs/flux-schnell')).toBe(true);
      expect(service.pricingCategory('black-forest-labs/flux-schnell')).toBe(
        'output',
      );
      expect(service.getPrice('black-forest-labs/flux-schnell')).toMatchObject({
        kind: 'per-image',
        usd: 0.003,
      });
      expect(service.getPrice('unknown/model')).toBeNull();
    });
  });
});
