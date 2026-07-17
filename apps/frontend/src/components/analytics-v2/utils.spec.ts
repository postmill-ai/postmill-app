import { describe, it, expect } from 'vitest';
import { formatCompactNumber, formatPercent } from './utils';

describe('formatCompactNumber', () => {
  it('formats 0', () => {
    expect(formatCompactNumber(0)).toBe('0');
  });

  it('formats numbers below 1000', () => {
    expect(formatCompactNumber(500)).toBe('500');
    expect(formatCompactNumber(999)).toBe('999');
  });

  it('formats 1000 as 1K', () => {
    expect(formatCompactNumber(1000)).toBe('1.0K');
  });

  it('formats 1500 as 1.5K', () => {
    expect(formatCompactNumber(1500)).toBe('1.5K');
  });

  it('formats 999_999 as 1000.0K (below 1M threshold)', () => {
    expect(formatCompactNumber(999_999)).toBe('1000.0K');
  });

  it('formats 1_000_000 as 1.0M', () => {
    expect(formatCompactNumber(1_000_000)).toBe('1.0M');
  });

  it('formats 1_500_000 as 1.5M', () => {
    expect(formatCompactNumber(1_500_000)).toBe('1.5M');
  });

  it('formats 1_000_000_000 as 1.0B', () => {
    expect(formatCompactNumber(1_000_000_000)).toBe('1.0B');
  });

  it('formats 2_500_000_000 as 2.5B', () => {
    expect(formatCompactNumber(2_500_000_000)).toBe('2.5B');
  });

  it('handles negative numbers', () => {
    expect(formatCompactNumber(-500)).toBe('-500');
    expect(formatCompactNumber(-1_500)).toBe('-1,500');
    expect(formatCompactNumber(-2_000_000)).toBe('-2,000,000');
  });
});

describe('formatPercent', () => {
  it('formats 0', () => {
    expect(formatPercent(0)).toBe('0.0%');
  });

  it('formats 50', () => {
    expect(formatPercent(50)).toBe('50.0%');
  });

  it('formats 100', () => {
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('rounds to one decimal place', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
  });

  it('formats negative percentages', () => {
    expect(formatPercent(-25.5)).toBe('-25.5%');
  });

  it('formats small percentages', () => {
    expect(formatPercent(0.1)).toBe('0.1%');
  });
});
