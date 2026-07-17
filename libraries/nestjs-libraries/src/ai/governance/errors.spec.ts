import { describe, it, expect } from 'vitest';
import { BudgetExceeded, GuardrailViolation, CapabilityNotAvailable } from './errors';

describe('BudgetExceeded', () => {
  it('creates an error with the correct name, message, scope and orgId', () => {
    const err = new BudgetExceeded('Monthly cap exceeded', 'generator', 'org-123');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('BudgetExceeded');
    expect(err.message).toBe('Monthly cap exceeded');
    expect(err.scope).toBe('generator');
    expect(err.organizationId).toBe('org-123');
  });

  it('works without an orgId', () => {
    const err = new BudgetExceeded('Global cap exceeded', 'utility');
    expect(err.organizationId).toBeUndefined();
  });
});

describe('GuardrailViolation', () => {
  it('creates an error with name, message, policy and action', () => {
    const err = new GuardrailViolation('Blocked by PII policy', 'pii-scanning', 'block');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('GuardrailViolation');
    expect(err.message).toBe('Blocked by PII policy');
    expect(err.policy).toBe('pii-scanning');
    expect(err.action).toBe('block');
  });

  it('supports redact and warn actions', () => {
    const redact = new GuardrailViolation('Redacted', 'moderation', 'redact');
    expect(redact.action).toBe('redact');
    const warn = new GuardrailViolation('Warning', 'moderation', 'warn');
    expect(warn.action).toBe('warn');
  });
});

describe('CapabilityNotAvailable', () => {
  it('creates an error with name, message and capability', () => {
    const err = new CapabilityNotAvailable('Image generation not available', 'image');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CapabilityNotAvailable');
    expect(err.message).toBe('Image generation not available');
    expect(err.capability).toBe('image');
  });
});
