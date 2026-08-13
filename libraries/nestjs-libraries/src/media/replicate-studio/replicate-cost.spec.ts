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
