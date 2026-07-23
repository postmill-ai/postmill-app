import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { repair } from '@reaatech/structured-repair-core';
import { z } from 'zod';
import type { DesignPlan } from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';

interface CopyBrand {
  instructions?: string;
  language?: string;
  palette?: string[];
  fontFamilies?: string[];
}

interface CopywriterInput {
  type: 'copy-request';
  plan: DesignPlan;
  brand: CopyBrand | null;
  slotTexts?: Record<string, string>;
}

@Injectable()
export class AiDesignerCopywriterService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerCopywriterService.name);

  constructor(private readonly _ai: AIModelProvider) {}

  onModuleInit() {
    registerInProcessAgent('copywriter', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    const payload = parseAgentInput<CopywriterInput>(context.raw_input);
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }
    const texts = await this._writeCopy(
      payload.plan,
      payload.brand,
      payload.slotTexts,
      (context.metadata?.orgId as string | undefined) ?? undefined
    );

    return {
      content: JSON.stringify({ type: 'copy', texts }),
      workflow_complete: false,
    };
  };

  private async _writeCopy(
    plan: DesignPlan,
    brand: CopyBrand | null,
    existingTexts: Record<string, string> | undefined,
    orgId: string | undefined
  ): Promise<Record<string, string>> {
    const textSlots = plan.slots.filter((s) => s.kind === 'text');
    if (textSlots.length === 0) {
      return {};
    }

    const reviseIds = new Set<string>();
    if (existingTexts && Object.keys(existingTexts).length > 0) {
      for (const slot of textSlots) {
        if (existingTexts[slot.id] !== undefined) {
          reviseIds.add(slot.id);
        }
      }
    }

    const system = this._buildSystemPrompt(plan, brand);
    const prompt = this._buildPrompt(plan, textSlots, existingTexts, reviseIds);

    const raw = await this._ai.generateText('utility', prompt, {
      system,
      orgId,
    });

    const parsed = await this._parseRawCopy(raw, textSlots);

    // For a revise request, keep unchanged slots from the existing copy.
    if (existingTexts) {
      for (const slot of textSlots) {
        if (!reviseIds.has(slot.id)) {
          parsed[slot.id] = existingTexts[slot.id] ?? parsed[slot.id] ?? '';
        } else {
          parsed[slot.id] = parsed[slot.id] ?? existingTexts[slot.id] ?? '';
        }
      }
    }

    const result: Record<string, string> = {};
    const missing: string[] = [];
    for (const slot of textSlots) {
      if (parsed[slot.id]) {
        result[slot.id] = parsed[slot.id];
      } else {
        // Do NOT backfill '' — an empty string masks the miss from every
        // downstream fallback (it reads as "copy present").
        missing.push(slot.id);
      }
    }
    if (missing.length > 0) {
      this._logger.warn(
        `Copywriter could not bind copy for slots [${missing.join(', ')}].`
      );
    }
    return result;
  }

  private _buildSystemPrompt(plan: DesignPlan, brand: CopyBrand | null): string {
    const parts: string[] = [
      'You are a marketing copywriter for an AI design assistant.',
      `The design uses the "${plan.skill}" skill.`,
      'Write copy that fits the design concept and respects the role of each text slot.',
      '',
      'Length constraints by slot role:',
      '- headline / caption / top-caption / bottom-caption: short and punchy (a few words to one sentence).',
      '- body: concise, 1-2 sentences.',
      '- cta: 2-4 words.',
      '',
      'Return ONLY the requested slot mapping. Prefer JSON in the form {"slotId": "text", ...}.',
      'If you cannot return JSON, return one line per slot in the format "slotId: text".',
    ];

    if (brand) {
      if (brand.instructions) {
        parts.push('', 'Brand voice:', brand.instructions);
      }
      if (brand.language) {
        parts.push('', `Write in ${brand.language}.`);
      }
      if (brand.palette && brand.palette.length > 0) {
        parts.push('', `Brand palette: ${brand.palette.join(', ')}.`);
      }
      if (brand.fontFamilies && brand.fontFamilies.length > 0) {
        parts.push('', `Brand fonts: ${brand.fontFamilies.join(', ')}.`);
      }
    }

    return parts.join('\n');
  }

  private _buildPrompt(
    plan: DesignPlan,
    textSlots: DesignPlan['slots'],
    existingTexts: Record<string, string> | undefined,
    reviseIds: Set<string>
  ): string {
    const lines: string[] = [
      `Concept: ${plan.concept || 'No concept provided.'}`,
      '',
      'Text slots to fill:',
    ];

    for (const slot of textSlots) {
      lines.push(`- ${slot.id} (role: ${slot.role})`);
    }

    if (existingTexts && Object.keys(existingTexts).length > 0) {
      lines.push('', 'Existing copy:');
      for (const slot of textSlots) {
        const text = existingTexts[slot.id] ?? '';
        lines.push(`- ${slot.id}: ${text}`);
      }

      if (reviseIds.size > 0) {
        lines.push(
          '',
          `Rewrite ONLY these slots: ${Array.from(reviseIds).join(', ')}.`,
          'Keep all other slots exactly as they are.'
        );
      }
    }

    lines.push(
      '',
      `Return a JSON object mapping each slot id to its copy: ${textSlots
        .map((s) => s.id)
        .join(', ')}.`
    );

    return lines.join('\n');
  }

  private async _parseRawCopy(
    raw: string,
    slots: { id: string; role?: string }[]
  ): Promise<Record<string, string>> {
    // Layer 1: structured repair (fenced/malformed JSON normalized).
    try {
      const repaired = await repair(z.record(z.string()), raw);
      if (repaired && typeof repaired === 'object' && !Array.isArray(repaired)) {
        const matched = this._matchSlots(repaired as Record<string, string>, slots);
        if (Object.keys(matched).length > 0) return matched;
      }
    } catch {
      // Fall through to JSON.parse / line extraction.
    }

    // Layer 2: plain JSON.
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const matched = this._matchSlots(parsed, slots);
        if (Object.keys(matched).length > 0) return matched;
      }
    } catch {
      // Fall through to line extraction.
    }

    // Layer 3: "key: text" lines.
    const lines: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const id = line
        .slice(0, idx)
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '');
      const text = line
        .slice(idx + 1)
        .trim()
        .replace(/,$/, '')
        .replace(/^["'`]+|["'`]+$/g, '');
      if (id && text) lines[id] = text;
    }
    return this._matchSlots(lines, slots);
  }

  /** Match model-returned keys to slots by exact id, then normalized id/role —
   *  models routinely key by the slot's ROLE (e.g. "primaryHeadline") instead
   *  of its id ("headline"). */
  private _matchSlots(
    record: Record<string, unknown>,
    slots: { id: string; role?: string }[]
  ): Record<string, string> {
    const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
    const out: Record<string, string> = {};
    const entries = Object.entries(record).filter(
      ([, v]) => typeof v === 'string' && (v as string).trim().length > 0
    ) as [string, string][];
    for (const slot of slots) {
      const exact = entries.find(([k]) => k === slot.id);
      if (exact) { out[slot.id] = exact[1]; continue; }
      const wantId = norm(slot.id);
      const wantRole = norm(slot.role || '');
      const fuzzy = entries.find(([k]) => {
        const nk = norm(k);
        return nk === wantId || (wantRole && (nk === wantRole || nk.includes(wantRole) || wantRole.includes(nk)));
      });
      if (fuzzy) out[slot.id] = fuzzy[1];
    }
    return out;
  }
}
