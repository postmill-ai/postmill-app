import { Injectable, Logger } from '@nestjs/common';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { GuardrailViolation } from './errors';
import {
  ChainBuilder,
  ChainContext,
  ChainResult,
  Guardrail,
  GuardrailResult,
  createChainContext,
  generateCorrelationId,
} from '@reaatech/guardrail-chain';

interface GuardrailEntry {
  enabled: boolean;
  action: 'block' | 'redact' | 'warn';
  sensitivity?: number;
  patterns?: string[];
  categories?: string[];
  blockedTerms?: string[];
}

interface GuardrailSettingsConfig {
  enabled?: boolean;
  inputGuardrails?: {
    promptInjection?: GuardrailEntry;
    piiScanning?: GuardrailEntry;
    moderationPolicies?: GuardrailEntry;
  };
  outputGuardrails?: {
    contentPolicy?: GuardrailEntry;
    brandSafety?: GuardrailEntry;
    nsfwDetection?: GuardrailEntry;
  };
  budget?: {
    maxLatencyMs?: number;
    maxTokens?: number;
    skipSlowGuardrailsUnderPressure?: boolean;
  };
}

const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_PATTERN = /\+?\d{1,4}[-.\s]\(?\d{1,4}\)?[-.\s]\d{1,4}[-.\s]\d{4,9}/g;
const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/g;
const CC_PATTERN = /\b(?:\d[ -]?){13,16}\b/g;

const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?previous\s+(instructions|directives|commands|orders)/i,
  /you\s+are\s+(now|an?\s+AI|a\s+free|released|unleashed)/i,
  /forget\s+(all\s+)?(previous|prior)\s+(instructions|training)/i,
  /system\s+prompt/i,
  /DAN|do\s+anything\s+now/i,
  /you\s+must\s+ignore\s+(your\s+)?(rules|guidelines|policies)/i,
  /bypass\s+(the\s+)?(restrictions|limitations|safety|filter)/i,
  /override\s+(your\s+)?(constraints|constraint|settings)/i,
];

const MODERATION_CATEGORIES: Record<string, RegExp[]> = {
  hateSpeech: [/hate\s+speech/i, /\bkill\s+all\b/i, /\bexterminate\b/i],
  violence: [/\bkill\b/i, /\bmurder\b/i, /\btorture\b/i, /\bterrorist\b/i],
  harassment: [/\bstupid\b/i, /\bidiot\b/i, /\bscam\b/i],
  selfHarm: [/\bsuicide\b/i, /\bself[\s-]?harm\b/i, /\bcut\s+(myself|yourself)\b/i],
};

const NSFW_PATTERNS = [
  /\bexplicit\b/i,
  /\bnsfw\b/i,
  /\badult\s+content\b/i,
  /\bporn\b/i,
  /\bxxx\b/i,
];

const BRAND_BLOCKED_TERMS: string[] = [];

abstract class BaseGuardrail implements Guardrail<string, string> {
  abstract readonly id: string;
  abstract readonly name: string;
  enabled = true;
  readonly shortCircuitOnFail = true;
  priority = 10;
  estimatedCostMs = 2;
  protected readonly _logger = new Logger('Guardrail');

  constructor(
    readonly type: 'input' | 'output',
    protected config: GuardrailEntry,
  ) {
    this.enabled = config.enabled;
    this.priority = config.action === 'block' ? 5 : 10;
  }

  abstract check(input: string): { detected: boolean; matches: string[] };

  async execute(input: string, _context: ChainContext): Promise<GuardrailResult<string>> {
    const { detected, matches } = this.check(input);

    if (!detected) {
      return { passed: true, metadata: { duration: 0 } };
    }

    if (this.config.action === 'warn') {
      this._logger.warn(`[Guardrail:${this.id}] ${matches.length} match(es) — action=warn`);
      return { passed: true, metadata: { duration: 0, matches } };
    }

    if (this.config.action === 'redact') {
      let redacted = input;
      for (const m of matches) {
        redacted = redacted.replace(m, '[REDACTED]');
      }
      return { passed: true, output: redacted, metadata: { duration: 0, matches } };
    }

    return {
      passed: false,
      error: new Error(`Guardrail "${this.id}" blocked: ${matches.slice(0, 3).join(', ')}`),
      metadata: { duration: 0, matches },
    };
  }
}

class PromptInjectionGuard extends BaseGuardrail {
  readonly id = 'prompt-injection';
  readonly name = 'Prompt Injection Detection';
  override readonly type = 'input' as const;

  constructor(config: GuardrailEntry) {
    super('input', config);
  }

  check(input: string) {
    const patterns = this.config.patterns
      ? this.config.patterns.map((p) => new RegExp(p, 'i'))
      : PROMPT_INJECTION_PATTERNS;
    const matches: string[] = [];
    for (const p of patterns) {
      const m = input.match(p);
      if (m) matches.push(m[0]);
    }
    return { detected: matches.length > 0, matches };
  }
}

class PIIScanningGuard extends BaseGuardrail {
  readonly id = 'pii-scanning';
  readonly name = 'PII Scanning';
  override readonly type = 'input' as const;

  constructor(config: GuardrailEntry) {
    super('input', config);
  }

  check(input: string) {
    const matches: string[] = [];
    const patterns = [EMAIL_PATTERN, PHONE_PATTERN, SSN_PATTERN, CC_PATTERN];
    for (const p of patterns) {
      const m = input.match(p);
      if (m) matches.push(...m);
    }
    return { detected: matches.length > 0, matches };
  }
}

class ModerationPolicyGuard extends BaseGuardrail {
  readonly id = 'moderation-policies';
  readonly name = 'Moderation Policies';
  override readonly type = 'input' as const;

  constructor(config: GuardrailEntry) {
    super('input', config);
  }

  check(input: string) {
    const matches: string[] = [];
    const cats = this.config.categories?.length
      ? this.config.categories
      : Object.keys(MODERATION_CATEGORIES);
    for (const cat of cats) {
      const patterns = MODERATION_CATEGORIES[cat];
      if (!patterns) continue;
      for (const p of patterns) {
        const m = input.match(p);
        if (m) matches.push(`[${cat}] ${m[0]}`);
      }
    }
    return { detected: matches.length > 0, matches };
  }
}

class ContentPolicyGuard extends BaseGuardrail {
  readonly id = 'content-policy';
  readonly name = 'Content Policy';
  override readonly type = 'output' as const;

  constructor(config: GuardrailEntry) {
    super('output', config);
  }

  check(input: string) {
    const matches: string[] = [];
    const cats = this.config.categories?.length
      ? this.config.categories
      : Object.keys(MODERATION_CATEGORIES);
    for (const cat of cats) {
      const patterns = MODERATION_CATEGORIES[cat];
      if (!patterns) continue;
      for (const p of patterns) {
        const m = input.match(p);
        if (m) matches.push(`[${cat}] ${m[0]}`);
      }
    }
    return { detected: matches.length > 0, matches };
  }
}

class BrandSafetyGuard extends BaseGuardrail {
  readonly id = 'brand-safety';
  readonly name = 'Brand Safety';
  override readonly type = 'output' as const;

  constructor(config: GuardrailEntry) {
    super('output', config);
  }

  check(input: string) {
    const terms = this.config.blockedTerms?.length
      ? this.config.blockedTerms
      : BRAND_BLOCKED_TERMS;
    const matches: string[] = [];
    for (const t of terms) {
      const p = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      const m = input.match(p);
      if (m) matches.push(m[0]);
    }
    return { detected: matches.length > 0, matches };
  }
}

class NSFWDetectionGuard extends BaseGuardrail {
  readonly id = 'nsfw-detection';
  readonly name = 'NSFW Detection';
  override readonly type = 'output' as const;

  constructor(config: GuardrailEntry) {
    super('output', config);
  }

  check(input: string) {
    const patterns = this.config.patterns
      ? this.config.patterns.map((p) => new RegExp(p, 'i'))
      : NSFW_PATTERNS;
    const matches: string[] = [];
    for (const p of patterns) {
      const m = input.match(p);
      if (m) matches.push(m[0]);
    }
    return { detected: matches.length > 0, matches };
  }
}

@Injectable()
export class GuardrailService {
  /**
   * All guardrails are regex-pattern-based checks — they do not invoke LLM calls,
   * so no budget pre-flight (cost cap) is applied. The budget config passed to
   * ChainBuilder only controls pressure-skipping and latency limits.
   */
  private _cachedSettingsKey: string | null = null;
  private _cachedInputChain: any = null;
  private _cachedOutputChain: any = null;

  constructor(private _aiSettingsManager: AiSettingsManager) {}

  /**
   * Invalidates the cached chains so next checkInput/checkOutput call rebuilds them.
   * Call this after admin updates guardrail settings.
   */
  invalidateCache(): void {
    this._cachedSettingsKey = null;
    this._cachedInputChain = null;
    this._cachedOutputChain = null;
  }

  private _parseSettings(raw: string | Record<string, any> | null | undefined): GuardrailSettingsConfig {
    if (!raw) return {};
    if (typeof raw !== 'string') return raw as GuardrailSettingsConfig;
    try {
      return JSON.parse(raw) as GuardrailSettingsConfig;
    } catch {
      return {};
    }
  }

  private _isActive(entry: GuardrailEntry | undefined): entry is GuardrailEntry {
    return !!entry?.enabled;
  }

  private _buildInputGuardrails(settings: GuardrailSettingsConfig): Guardrail<string, string>[] {
    const list: Guardrail<string, string>[] = [];
    const inp = settings.inputGuardrails;
    if (!inp) return list;

    if (this._isActive(inp.promptInjection)) {
      list.push(new PromptInjectionGuard(inp.promptInjection));
    }
    if (this._isActive(inp.piiScanning)) {
      list.push(new PIIScanningGuard(inp.piiScanning));
    }
    if (this._isActive(inp.moderationPolicies)) {
      list.push(new ModerationPolicyGuard(inp.moderationPolicies));
    }
    return list;
  }

  private _buildOutputGuardrails(settings: GuardrailSettingsConfig): Guardrail<string, string>[] {
    const list: Guardrail<string, string>[] = [];
    const outp = settings.outputGuardrails;
    if (!outp) return list;

    if (this._isActive(outp.contentPolicy)) {
      list.push(new ContentPolicyGuard(outp.contentPolicy));
    }
    if (this._isActive(outp.brandSafety)) {
      list.push(new BrandSafetyGuard(outp.brandSafety));
    }
    if (this._isActive(outp.nsfwDetection)) {
      list.push(new NSFWDetectionGuard(outp.nsfwDetection));
    }
    return list;
  }

  private _budgetConfig(settings: GuardrailSettingsConfig) {
    const b = settings.budget;
    return {
      maxLatencyMs: b?.maxLatencyMs ?? 500,
      maxTokens: b?.maxTokens ?? 2000,
      skipSlowGuardrailsUnderPressure: b?.skipSlowGuardrailsUnderPressure ?? true,
    };
  }

  private async _getSettings(): Promise<GuardrailSettingsConfig> {
    const sys = await this._aiSettingsManager.getSettings();
    if (!sys) return {};
    return this._parseSettings(sys.guardrailSettings);
  }

  private async _getOrBuildChains(): Promise<{ inputChain: any; outputChain: any; budget: any }> {
    const settings = await this._getSettings();

    const settingsKey = JSON.stringify(settings);
    if (this._cachedSettingsKey === settingsKey && this._cachedInputChain) {
      return { inputChain: this._cachedInputChain, outputChain: this._cachedOutputChain, budget: this._budgetConfig(settings) };
    }

    const inputGuardrails = this._buildInputGuardrails(settings);
    const outputGuardrails = this._buildOutputGuardrails(settings);
    const budget = this._budgetConfig(settings);

    // Null old references first so GC can reclaim them before allocating new chains
    this._cachedInputChain = null;
    this._cachedOutputChain = null;

    this._cachedInputChain = new ChainBuilder()
      .withBudget(budget)
      .withGuardrails(inputGuardrails)
      .build();

    this._cachedOutputChain = new ChainBuilder()
      .withBudget(budget)
      .withGuardrails(outputGuardrails)
      .build();

    this._cachedSettingsKey = settingsKey;

    return { inputChain: this._cachedInputChain, outputChain: this._cachedOutputChain, budget };
  }

  private _chainResult(
    result: ChainResult,
    original: string,
  ): string {
    if (!result.success) {
      throw new GuardrailViolation(
        result.error || 'Content blocked by guardrail',
        result.failedGuardrail || 'guardrail',
        'block',
      );
    }
    return (typeof result.output === 'string' ? result.output : original) as string;
  }

  async checkInput(
    content: string,
    options?: { userId?: string; orgId?: string },
  ): Promise<string> {
    const { inputChain } = await this._getOrBuildChains();
    if (!inputChain) return content;

    const result = await inputChain.executeInput(content, {
      userId: options?.userId,
      correlationId: generateCorrelationId(),
      metadata: options?.orgId ? { orgId: options.orgId } : undefined,
    });

    return this._chainResult(result, content);
  }

  async checkOutput(
    content: string,
    options?: { userId?: string; orgId?: string },
  ): Promise<string> {
    const { outputChain, budget } = await this._getOrBuildChains();
    if (!outputChain) return content;

    const ctx = createChainContext(content, budget, {
      userId: options?.userId,
      metadata: options?.orgId ? { orgId: options.orgId } : undefined,
    });
    const result = await outputChain.executeOutput(content, ctx);

    return this._chainResult(result, content);
  }
}
