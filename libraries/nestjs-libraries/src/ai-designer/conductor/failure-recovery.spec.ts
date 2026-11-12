import { describe, expect, it, vi } from 'vitest';
import { ProviderUpstreamError } from '@postmill-ai/provider-kernel';
import { AiDesignerConductorService } from './ai-designer-conductor.service';
import {
  aiDesignerFailureKind,
  aiDesignerFailureText,
} from './failure-recovery';

const upstream = (
  kind: ConstructorParameters<typeof ProviderUpstreamError>[1],
  detail = 'secret upstream response: sk-live-secret'
) =>
  new ProviderUpstreamError(
    { domain: 'ai', providerId: 'openai', providerName: 'OpenAI' },
    kind,
    detail,
    kind === 'auth' ? 401 : kind === 'quota' || kind === 'rate_limit' ? 429 : 503
  );

describe('AI Designer sanitized failure recovery', () => {
  it.each([
    ['quota', 'quota', 'quota or billing limit'],
    ['auth', 'auth', 'rejected its credentials'],
    ['rate_limit', 'rate_limit', 'rate-limiting requests'],
    ['timeout', 'timeout', 'took too long'],
    ['unavailable', 'outage', 'unavailable right now'],
  ] as const)('maps typed %s failures without upstream detail', (kind, category, text) => {
    const error = upstream(kind);
    expect(aiDesignerFailureKind(error)).toBe(category);
    expect(aiDesignerFailureText(error)).toContain(text);
    expect(aiDesignerFailureText(error)).not.toContain('sk-live-secret');
    expect(aiDesignerFailureText(error)).not.toContain('secret upstream response');
  });

  it('recognizes the typed circuit-breaker detail as a temporary pause', () => {
    const error = upstream(
      'unavailable',
      'paused after repeated failures (circuit breaker open) — retry in a moment'
    );
    expect(aiDesignerFailureKind(error)).toBe('circuit_breaker');
    expect(aiDesignerFailureText(error)).toContain('briefly paused');
  });

  it('keeps legacy circuit and timeout recovery without echoing error text', () => {
    expect(aiDesignerFailureText(new Error('Circuit open for agent composer'))).toContain(
      'briefly paused'
    );
    expect(aiDesignerFailureText(new Error('Agent composer timed out after 120000ms'))).toBe(
      'The AI provider took too long to respond — please try again.'
    );
  });

  it('keeps upstream details out of recovery chat and logs', async () => {
    const service = {
      updateSession: vi.fn().mockResolvedValue(undefined),
      appendMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
    };
    const conductor = new AiDesignerConductorService(
      service as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any
    );
    const warn = vi.fn();
    (conductor as any)._logger.warn = warn;
    const emit = {
      toSession: vi.fn(),
      progress: vi.fn(),
      preview: vi.fn(),
      error: vi.fn(),
    };
    const error = upstream(
      'unavailable',
      'circuit breaker open; raw provider body=sk-live-secret'
    );

    await (conductor as any)._recoverFromFailure(
      'session-1',
      { orgId: 'org-1', userId: 'user-1', sessionId: 'session-1' },
      emit,
      error,
      'intake'
    );

    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('circuit_breaker');
    expect(logged).not.toContain('sk-live-secret');
    expect(logged).not.toContain('raw provider body');
    const chat = JSON.stringify(service.appendMessage.mock.calls);
    expect(chat).toContain('briefly paused');
    expect(chat).not.toContain('sk-live-secret');
    expect(emit.error).toHaveBeenCalledWith(
      'agent_failed',
      expect.not.stringContaining('sk-live-secret')
    );
  });
});
