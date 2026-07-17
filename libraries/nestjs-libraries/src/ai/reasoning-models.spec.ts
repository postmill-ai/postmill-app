import { describe, it, expect } from 'vitest';
import {
  isReasoningModel,
  REASONING_MODEL_PREFIXES,
} from './reasoning-models';

describe('isReasoningModel', () => {
  it('matches known reasoning-model prefixes case-insensitively', () => {
    expect(isReasoningModel('o1-preview')).toBe(true);
    expect(isReasoningModel('O3-mini')).toBe(true);
    expect(isReasoningModel('deepseek-reasoner')).toBe(true);
    expect(isReasoningModel('QwQ-32B')).toBe(true);
  });

  it('returns false for non-reasoning models', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('claude-3-5-sonnet')).toBe(false);
    expect(isReasoningModel('')).toBe(false);
  });

  it('exposes a non-empty prefix catalog', () => {
    expect(REASONING_MODEL_PREFIXES.length).toBeGreaterThan(0);
  });
});
