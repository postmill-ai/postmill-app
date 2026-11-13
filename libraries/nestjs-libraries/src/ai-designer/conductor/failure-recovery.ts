import { ProviderUpstreamError, redactError } from '@postmill-ai/provider-kernel';
import {
  BudgetExceeded,
  GuardrailViolation,
} from '@postmill-ai/nestjs-libraries/ai/governance/errors';

export class AiDesignerBusyError extends Error {
  constructor() {
    super('AI Designer is still working on the previous request.');
    this.name = 'AiDesignerBusyError';
  }
}

export type AiDesignerFailureKind =
  | 'guardrail'
  | 'budget'
  | 'quota'
  | 'auth'
  | 'rate_limit'
  | 'circuit_breaker'
  | 'timeout'
  | 'outage'
  | 'unknown';

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : '';

const isCircuitBreaker = (err: unknown): boolean =>
  /circuit(?:\s+breaker)?\s+open/i.test(errorMessage(err)) ||
  (err instanceof ProviderUpstreamError &&
    /circuit(?:\s+breaker)?\s+open/i.test(err.detail));

export const aiDesignerFailureKind = (
  err: unknown
): AiDesignerFailureKind => {
  if (err instanceof GuardrailViolation) return 'guardrail';
  if (err instanceof BudgetExceeded) return 'budget';
  if (isCircuitBreaker(err)) return 'circuit_breaker';
  if (err instanceof ProviderUpstreamError) {
    switch (err.kind) {
      case 'quota':
        return 'quota';
      case 'auth':
        return 'auth';
      case 'rate_limit':
        return 'rate_limit';
      case 'timeout':
        return 'timeout';
      case 'unavailable':
        return 'outage';
      default:
        return 'unknown';
    }
  }

  const message = errorMessage(err);
  if (/budget/i.test(message)) return 'budget';
  if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (/rate[ _-]?limit|too many requests/i.test(message)) return 'rate_limit';
  if (/unavailable|fetch failed|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) {
    return 'outage';
  }
  return 'unknown';
};

export const aiDesignerFailureLog = (
  err: unknown,
  category: AiDesignerFailureKind | 'invalid_payload' | 'busy' = aiDesignerFailureKind(err)
): string => {
  const name = redactError(
    err instanceof Error && err.name ? err.name : 'UnknownError',
    100
  );
  if (err instanceof ProviderUpstreamError) {
    return [
      `kind=${category}`,
      `name=${name}`,
      `provider=${redactError(err.ctx.providerId, 100)}`,
      ...(err.upstreamStatus !== undefined
        ? [`upstreamStatus=${err.upstreamStatus}`]
        : []),
    ].join(' ');
  }
  const message = redactError(
    err instanceof Error ? err.message : String(err ?? ''),
    500
  );
  return `kind=${category} name=${name} message=${message}`;
};

export const aiDesignerFailureText = (err: unknown): string => {
  if (err instanceof GuardrailViolation) {
    return "That request was blocked by this workspace's content guardrails.";
  }
  const message = errorMessage(err);
  if (message.startsWith('No generated variant contains the requested subject:')) {
    return message;
  }

  switch (aiDesignerFailureKind(err)) {
    case 'budget':
      return 'The AI budget for this workspace is exhausted — an admin can raise it under Settings → AI.';
    case 'quota':
      return "The configured AI provider's quota or billing limit was reached. Update that provider account or select another provider in Settings, then try again.";
    case 'auth':
      return 'The configured AI provider rejected its credentials. An admin can update them in Settings, then you can try again.';
    case 'rate_limit':
      return 'The configured AI provider is rate-limiting requests. Wait a moment, then try again.';
    case 'circuit_breaker':
      return 'AI Designer is briefly paused after repeated provider failures — please try again in a minute.';
    case 'timeout':
      return 'The AI provider took too long to respond — please try again.';
    case 'outage':
      return 'The configured AI provider is unavailable right now. Please try again shortly.';
    default:
      return 'I hit a problem while working on this — please try again.';
  }
};
