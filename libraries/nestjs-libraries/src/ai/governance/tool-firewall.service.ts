import { Injectable, Logger, Optional } from '@nestjs/common';
import { SpanStatusCode } from '@opentelemetry/api';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';

/**
 * Tool-use firewall (section 5 / section 8 / decision #8).
 *
 * The plan deferred this to a not-yet-published `@reaatech` "tool-use firewall" package
 * and relied on the published guardrail chain as the baseline. This is the real in-repo
 * implementation so nothing is deferred: it interposes on every agent/MCP tool invocation
 * and validates the call *before* it executes, defending against prompt-injection-driven
 * tool abuse (a jailbroken model trying to call a denied tool, smuggle oversized/binary
 * payloads, or pass control-character markers as arguments).
 *
 * Defaults are permissive (no denied tools) so existing behaviour is unchanged; an
 * operator tightens it via `AISystemSettings` (deny-list / size cap). Blocking throws a
 * `ToolFirewallBlocked` error, which the agent surfaces as a normal tool error.
 */
export class ToolFirewallBlocked extends Error {
  constructor(public readonly toolName: string, public readonly reason: string) {
    super(`Tool "${toolName}" blocked by firewall: ${reason}`);
    this.name = 'ToolFirewallBlocked';
  }
}

export interface ToolFirewallOptions {
  /** Tool names that may never be invoked. */
  deniedTools: string[];
  /** When set, only these tool names may be invoked (allow-list wins over deny-list). */
  allowedTools?: string[];
  /** Reject a single tool call whose serialized input exceeds this many bytes. */
  maxInputBytes: number;
  /** Reject NUL / C0 control characters (except tab/LF/CR) smuggled into tool input. */
  blockControlChars: boolean;
  /** Additional operator-supplied patterns to reject. */
  blockedInputPatterns: RegExp[];
}

// Built from an ASCII-only string (no literal control bytes in source): matches NUL
// (0x00) and other C0 control characters, excluding 0x09 (tab), 0x0a (LF), 0x0d (CR).
const CONTROL_CHAR_PATTERN = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]');
// JSON.stringify escapes dangerous control chars inside object values as \u00XX (tab/LF/CR
// become \t/\n/\r and are intentionally NOT matched here), so when the input was serialized
// we must also catch the escaped form (0x00-0x08, 0x0b, 0x0c, 0x0e-0x1f).
const ESCAPED_CONTROL_CHAR_PATTERN = new RegExp('\\\\u00(0[0-8]|0[bc]|0[ef]|1[0-9a-f])', 'i');

const DEFAULT_OPTIONS: ToolFirewallOptions = {
  deniedTools: [],
  maxInputBytes: 256 * 1024, // 256 KB — a tool argument blob larger than this is abuse, not use
  blockControlChars: true,
  blockedInputPatterns: [],
};

@Injectable()
export class ToolFirewallService {
  private readonly _logger = new Logger(ToolFirewallService.name);

  // @Optional so Nest can instantiate this as a provider — `ToolFirewallOptions` is an
  // interface (no DI token), so without @Optional the container would fail to resolve it.
  // `_telemetry` is optional so the service works (unchanged) when telemetry is not wired.
  constructor(
    @Optional() private _options: ToolFirewallOptions = DEFAULT_OPTIONS,
    @Optional() private _telemetry?: TelemetryService,
  ) {}

  configure(options: Partial<ToolFirewallOptions>) {
    this._options = { ...this._options, ...options };
  }

  /**
   * Returns `{ allowed }`; when blocked, `reason` explains why. Never throws.
   */
  check(toolName: string, input: unknown): { allowed: boolean; reason?: string } {
    const o = this._options;

    if (o.allowedTools && o.allowedTools.length > 0 && !o.allowedTools.includes(toolName)) {
      return { allowed: false, reason: 'tool not in allow-list' };
    }
    if (o.deniedTools.includes(toolName)) {
      return { allowed: false, reason: 'tool is denied' };
    }

    let serialized = '';
    try {
      serialized = typeof input === 'string' ? input : JSON.stringify(input ?? '');
    } catch {
      return { allowed: false, reason: 'tool input is not serializable' };
    }

    if (Buffer.byteLength(serialized, 'utf8') > o.maxInputBytes) {
      return { allowed: false, reason: `tool input exceeds ${o.maxInputBytes} bytes` };
    }
    if (
      o.blockControlChars &&
      (CONTROL_CHAR_PATTERN.test(serialized) || ESCAPED_CONTROL_CHAR_PATTERN.test(serialized))
    ) {
      return { allowed: false, reason: 'tool input contains control characters' };
    }
    for (const pattern of o.blockedInputPatterns) {
      if (pattern.test(serialized)) {
        return { allowed: false, reason: 'tool input matched a blocked pattern' };
      }
    }
    return { allowed: true };
  }

  /**
   * Wraps a Mastra-style tool so its `execute` is firewalled. The tool's input args are
   * passed to `execute` as the first argument's `.context` (Mastra convention); we check
   * that before delegating. Tools without an `execute` fn are returned untouched.
   *
   * When a `TelemetryService` is injected, each execution is recorded as an
   * `agent.tool.<toolName>` span with success/failure status and the serialized input
   * size in bytes. If telemetry is absent or unconfigured, behavior is unchanged.
   */
  wrap<T extends { execute?: (...args: any[]) => any }>(toolName: string, tool: T): T {
    if (!tool || typeof tool.execute !== 'function') return tool;
    const original = tool.execute.bind(tool);
    return {
      ...tool,
      execute: async (...args: any[]) => {
        const input = args?.[0]?.context ?? args?.[0];
        const verdict = this.check(toolName, input);
        if (!verdict.allowed) {
          this._logger.warn(`blocked tool "${toolName}": ${verdict.reason}`);
          throw new ToolFirewallBlocked(toolName, verdict.reason || 'blocked');
        }

        if (!this._telemetry) {
          return original(...args);
        }

        const serialized = typeof input === 'string' ? input : JSON.stringify(input ?? '');
        const inputBytes = Buffer.byteLength(serialized, 'utf8');

        return this._telemetry.startSpan(
          `agent.tool.${toolName}`,
          async (span) => {
            span.setAttribute('inputBytes', inputBytes);
            try {
              const result = await original(...args);
              span.setStatus({ code: SpanStatusCode.OK });
              return result;
            } catch (err) {
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: (err as Error).message,
              });
              throw err;
            }
          },
          { tool: toolName },
        );
      },
    };
  }
}
