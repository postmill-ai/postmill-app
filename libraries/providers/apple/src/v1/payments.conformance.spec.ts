import { describe, it, expect } from 'vitest';
import { runPaymentsConformance } from '@postmill-ai/provider-kernel';
import defaultModules from '../index';

describe('apple payments conformance', () => {
  it('payments module conforms', () => {
    const payments = defaultModules.find((m) => m.manifest.domain === 'payments');
    expect(payments).toBeDefined();
    runPaymentsConformance(payments!);
  });
});
