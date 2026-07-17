import { Injectable } from '@nestjs/common';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';
import { AiDesignerService } from './ai-designer.service';

export interface GuardedInput {
  values: Record<string, unknown>;
  instruction?: string;
}

class InvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// Bounds on `form:submit` values. The DTO can only assert `@IsObject()`, so
// the byte/depth ceiling (the cost ceiling for what gets persisted into the
// brief and fed to agent prompts) is enforced here.
const MAX_FORM_VALUES_BYTES = 32_768;
const MAX_FORM_VALUES_DEPTH = 5;

// Keys must be short, strict identifiers. Anything outside this set could
// be an injection attempt (e.g., control characters, HTML/JS snippets, spaces,
// or overly-long keys used to pad the brief).
const KEY_REGEX = /^[\w-]{1,64}$/;

@Injectable()
export class AiDesignerInputPolicyService {
  constructor(private readonly _service: AiDesignerService) {}

  async check(
    input: GuardedInput,
    orgId: string
  ): Promise<
    | { ok: true; values: Record<string, unknown>; instruction?: string }
    | {
        ok: false;
        reason: 'guardrail_blocked' | 'value_bounds' | 'invalid_key';
        message: string;
      }
  > {
    const values = input.values ?? {};
    try {
      if (!this._withinValueBounds(values)) {
        return {
          ok: false,
          reason: 'value_bounds',
          message: `Form values exceed size or depth limits (${MAX_FORM_VALUES_BYTES} bytes, depth ${MAX_FORM_VALUES_DEPTH})`,
        };
      }

      const guardedValues = await this._guardValues(values, orgId);
      let instruction: string | undefined;
      if (input.instruction !== undefined) {
        instruction = (await this._guardValue(
          input.instruction,
          orgId
        )) as string;
      }

      return { ok: true, values: guardedValues, instruction };
    } catch (err) {
      if (err instanceof GuardrailViolation) {
        return {
          ok: false,
          reason: 'guardrail_blocked',
          message: err.message,
        };
      }
      if (err instanceof InvalidKeyError) {
        return {
          ok: false,
          reason: 'invalid_key',
          message: err.message,
        };
      }
      throw err;
    }
  }

  /**
   * True when the form-values object fits the byte and depth ceilings.
   * `values` is parsed JSON in the normal path, but guard against cycles and
   * other unstringifiable values defensively — a malformed payload must surface
   * as a bounds violation, not an unhandled exception.
   */
  private _withinValueBounds(values: Record<string, unknown>): boolean {
    let serialized: string;
    try {
      serialized = JSON.stringify(values);
    } catch {
      return false;
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FORM_VALUES_BYTES) {
      return false;
    }
    const depthOk = (value: unknown, depth: number): boolean => {
      if (depth > MAX_FORM_VALUES_DEPTH) return false;
      if (Array.isArray(value)) {
        return value.every((item) => depthOk(item, depth + 1));
      }
      if (value && typeof value === 'object') {
        return Object.values(value).every((item) => depthOk(item, depth + 1));
      }
      return true;
    };
    return depthOk(values, 0);
  }

  /**
   * Run every user-entered string in a values object — at any nesting depth —
   * through the org's input guardrail chain. A string that only reaches the
   * brief inside a nested object must not skip the chain.
   * Throws `GuardrailViolation` on a block; returns possibly-redacted values.
   */
  private async _guardValues(
    values: Record<string, unknown>,
    orgId: string
  ): Promise<Record<string, unknown>> {
    return (await this._guardValue(values, orgId)) as Record<string, unknown>;
  }

  private async _guardValue(value: unknown, orgId: string): Promise<unknown> {
    if (typeof value === 'string' && value.trim()) {
      return this._service.applyGuardrails(value, orgId);
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((item) => this._guardValue(item, orgId)));
    }
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        if (!KEY_REGEX.test(key)) {
          throw new InvalidKeyError(`Invalid form key: ${key}`);
        }
        out[key] = await this._guardValue(item, orgId);
      }
      return out;
    }
    return value;
  }
}
