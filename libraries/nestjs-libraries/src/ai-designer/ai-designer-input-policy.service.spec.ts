import { describe, it, expect, vi } from 'vitest';
import {
  AiDesignerInputPolicyService,
  GuardedInput,
} from './ai-designer-input-policy.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

const makeService = (
  guardrailImpl: (text: string, orgId?: string) => Promise<string> = async (
    text
  ) => text
) => {
  const service = {
    applyGuardrails: vi.fn(guardrailImpl),
  } as any;
  return { policy: new AiDesignerInputPolicyService(service), service };
};

const ORG_ID = 'org-1';

describe('AiDesignerInputPolicyService', () => {
  it('passes a clean string through the guardrail', async () => {
    const { policy, service } = makeService();
    const result = await policy.check(
      { values: {}, instruction: 'hello world' },
      ORG_ID
    );
    expect(result).toEqual({ ok: true, values: {}, instruction: 'hello world' });
    expect(service.applyGuardrails).toHaveBeenCalledWith('hello world', ORG_ID);
  });

  it('returns guardrail_blocked when the instruction is blocked', async () => {
    const { policy, service } = makeService(() => {
      throw new GuardrailViolation('blocked', 'policy-1', 'block');
    });
    const result = await policy.check(
      { values: {}, instruction: 'bad text' },
      ORG_ID
    );
    expect(result).toEqual({
      ok: false,
      reason: 'guardrail_blocked',
      message: 'blocked',
    });
    expect(service.applyGuardrails).toHaveBeenCalledWith('bad text', ORG_ID);
  });

  it('recursively guards nested strings inside values', async () => {
    const { policy, service } = makeService();
    const input: GuardedInput = {
      values: {
        intent: 'a promo',
        details: {
          audience: 'devs',
          tags: ['foo', 'bar'],
        },
      },
    };
    const result = await policy.check(input, ORG_ID);
    expect(result.ok).toBe(true);
    expect((result as any).values).toEqual({
      intent: 'a promo',
      details: {
        audience: 'devs',
        tags: ['foo', 'bar'],
      },
    });
    expect(service.applyGuardrails).toHaveBeenCalledWith('a promo', ORG_ID);
    expect(service.applyGuardrails).toHaveBeenCalledWith('devs', ORG_ID);
    expect(service.applyGuardrails).toHaveBeenCalledWith('foo', ORG_ID);
    expect(service.applyGuardrails).toHaveBeenCalledWith('bar', ORG_ID);
  });

  it('returns guardrail_blocked for a nested blocked string', async () => {
    const { policy, service } = makeService((text) => {
      if (text === 'bad nested') {
        throw new GuardrailViolation('nested blocked', 'policy-1', 'block');
      }
      return text;
    });
    const input: GuardedInput = {
      values: {
        outer: {
          inner: 'bad nested',
        },
      },
    };
    const result = await policy.check(input, ORG_ID);
    expect(result).toEqual({
      ok: false,
      reason: 'guardrail_blocked',
      message: 'nested blocked',
    });
    expect(service.applyGuardrails).toHaveBeenCalledWith('bad nested', ORG_ID);
  });

  it('returns value_bounds when byte size exceeds the cap', async () => {
    const { policy, service } = makeService();
    const input: GuardedInput = {
      values: {
        blob: 'x'.repeat(40_000),
      },
    };
    const result = await policy.check(input, ORG_ID);
    expect(result).toEqual({
      ok: false,
      reason: 'value_bounds',
      message: expect.stringContaining('32'),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('returns value_bounds for circular values instead of crashing', async () => {
    const { policy, service } = makeService();
    const circular: Record<string, unknown> = { v: 'leaf' };
    circular.self = circular;
    const result = await policy.check({ values: circular }, ORG_ID);
    expect(result).toEqual({
      ok: false,
      reason: 'value_bounds',
      message: expect.stringContaining('size or depth limits'),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('returns value_bounds when nesting depth exceeds the cap', async () => {
    const { policy, service } = makeService();
    const deep: Record<string, unknown> = { v: 'leaf' };
    let current: Record<string, unknown> = deep;
    for (let i = 0; i < 6; i++) {
      const next: Record<string, unknown> = { v: 'leaf' };
      current.nested = next;
      current = next;
    }
    const result = await policy.check({ values: deep }, ORG_ID);
    expect(result).toEqual({
      ok: false,
      reason: 'value_bounds',
      message: expect.stringContaining('depth'),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('returns invalid_key for keys outside the allowed character set', async () => {
    const { policy, service } = makeService();
    const result = await policy.check(
      { values: { 'intent<script>': 'x' } },
      ORG_ID
    );
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_key',
      message: expect.stringContaining('intent<script>'),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('returns invalid_key for keys longer than 64 characters', async () => {
    const { policy, service } = makeService();
    const longKey = 'a'.repeat(65);
    const result = await policy.check({ values: { [longKey]: 'x' } }, ORG_ID);
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_key',
      message: expect.stringContaining(longKey),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('rejects keys containing spaces', async () => {
    const { policy, service } = makeService();
    const result = await policy.check(
      { values: { 'user key': 'value' } },
      ORG_ID
    );
    expect(result).toEqual({
      ok: false,
      reason: 'invalid_key',
      message: expect.stringContaining('user key'),
    });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('passes an empty instruction without calling guardrails', async () => {
    const { policy, service } = makeService();
    const result = await policy.check({ values: {} }, ORG_ID);
    expect(result).toEqual({ ok: true, values: {} });
    expect(service.applyGuardrails).not.toHaveBeenCalled();
  });

  it('redacts an instruction returned by the guardrail', async () => {
    const { policy, service } = makeService((text) => text.replace(/secret/, '[REDACTED]'));
    const result = await policy.check(
      { values: {}, instruction: 'top secret plan' },
      ORG_ID
    );
    expect(result).toEqual({
      ok: true,
      values: {},
      instruction: 'top [REDACTED] plan',
    });
  });
});
