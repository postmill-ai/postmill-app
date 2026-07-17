import '@gitroom/nestjs-libraries/ai-designer/agent-mesh/agent-mesh-env.shim';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  registerInProcessAgent,
  type InProcessHandler,
} from '@reaatech/agent-mesh-router';
import type { AgentResponse, ContextPacket } from '@reaatech/agent-mesh';
import { readFile } from 'fs/promises';
import path from 'path';
import { AiDefaultsService } from '@gitroom/nestjs-libraries/ai/defaults/ai-defaults.service';
import { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import { CHANNEL_PRESETS } from '@gitroom/nestjs-libraries/integrations/social/channel-presets';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file-type.compat';
import type {
  DesignPlan,
  Fix,
  FixScope,
  VisionFinding,
} from '../../ai-designer.types';
import {
  isAgentInputError,
  parseAgentInput,
} from '../../util/parse-agent-input';

const VISION_CRITIC_MAX_INLINE_BYTES = 2 * 1024 * 1024;

const VISION_CRITIC_SCHEMA_BLOCK = `Return ONLY a JSON object in this exact shape:
{
  "findings": [
    {
      "formatId": "ig-reel",
      "slotId": "bottom-caption",
      "issue": "Caption text is positioned too low and overlaps the bottom UI safe zone.",
      "fix": {
        "scope": "format-only",
        "targetSlots": ["bottom-caption"],
        "geometry": { "y": 1500, "fontSize": 64 },
        "style": { "fill": "#000000", "opacity": 1 },
        "text": { "slotId": "bottom-caption", "newText": "Updated text" },
        "note": "Move caption above the bottom 200px safe zone and increase size for readability."
      }
    }
  ]
}`;

interface CritiqueRequest {
  type: 'critique-request';
  contactSheetUrl: string;
  plans?: DesignPlan[];
  outputs: { formatId: string; width: number; height: number }[];
  rubric: {
    criteria: { name: string; description: string; weight: number }[];
  };
  outputPreviews?: { formatId: string; url: string }[];
}

interface InterpretRequest {
  type: 'interpret-request';
  fileIds: string[];
}

@Injectable()
export class AiDesignerVisionCriticService implements OnModuleInit {
  private readonly _logger = new Logger(AiDesignerVisionCriticService.name);

  constructor(
    private readonly _aiDefaults: AiDefaultsService,
    private readonly _fileService: FileService
  ) {}

  onModuleInit() {
    registerInProcessAgent('vision-critic', this._handler.bind(this));
  }

  private _handler: InProcessHandler = async (
    context: ContextPacket
  ): Promise<AgentResponse> => {
    const orgId =
      context.metadata && typeof context.metadata.orgId === 'string'
        ? context.metadata.orgId
        : '';

    if (!orgId) {
      return {
        content: JSON.stringify({
          type: 'error',
          message:
            'Vision critic could not run: missing orgId in agent context metadata.',
        }),
        workflow_complete: false,
      };
    }

    const payload = parseAgentInput<CritiqueRequest | InterpretRequest>(
      context.raw_input
    );
    if (isAgentInputError(payload)) {
      return {
        content: JSON.stringify(payload),
        workflow_complete: false,
      };
    }

    if (payload.type === 'interpret-request') {
      const cues = await this.interpretReferences(orgId, payload.fileIds);
      return {
        content: JSON.stringify({ type: 'interpretations', cues }),
        workflow_complete: false,
      };
    }

    const findings = await this._critique(orgId, payload as CritiqueRequest);
    return {
      content: JSON.stringify({ type: 'findings', findings }),
      workflow_complete: false,
    };
  };

  async interpretReferences(
    orgId: string,
    fileIds: string[]
  ): Promise<string[]> {
    const cues: string[] = [];
    await Promise.all(
      fileIds.map(async (id) => {
        try {
          const file = await this._fileService.getFileById(orgId, id);
          // Defense-in-depth: the repository already scopes to the org.
          if (!file || !file.path) return;
          const imageUrl = await this._resolveImageUrl(orgId, file.path);
          if (!imageUrl) return;
          const prompt =
            'Describe this image concisely for a design assistant. List the dominant colors, mood/style, any text or logos, and the main subject. Keep it under 80 words.';
          const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt);
          const text = typeof raw === 'string' ? raw : String(raw);
          if (text.trim()) cues.push(text.trim());
        } catch (err) {
          this._logger.warn(
            `Reference interpretation failed for ${id}: ${(err as Error).message}`
          );
        }
      })
    );
    return cues;
  }

  private async _critique(
    orgId: string,
    payload: CritiqueRequest
  ): Promise<VisionFinding[]> {
    const imageUrl = await this._resolveImageUrl(orgId, payload.contactSheetUrl);
    if (!imageUrl) {
      return [];
    }

    const prompt = this._buildPrompt(payload);
    const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt);

    const findings = this._extractFindings(raw);
    if (findings.length === 0 || !payload.outputPreviews) {
      return findings;
    }

    // Tiered escalation: if the holistic contact-sheet pass flags detail or
    // legibility issues, run a full-res per-output pass for affected formats.
    const escalated = await this._escalate(orgId, payload, findings);
    return [...findings, ...escalated];
  }

  private _buildPrompt(payload: CritiqueRequest): string {
    const criteria = payload.rubric.criteria
      .map(
        (c, i) =>
          `${i + 1}. ${c.name} (weight ${c.weight}): ${c.description}`
      )
      .join('\n');

    const outputLines = payload.outputs
      .map((o) => {
        const preset = CHANNEL_PRESETS.find((p) => p.id === o.formatId);
        const safeZones = preset?.safeZones
          ?.map(
            (z) =>
              `      - ${z.label}: x=${z.x} y=${z.y} w=${z.width} h=${z.height} (${z.description})`
          )
          .join('\n');
        return [
          `- ${o.formatId}: ${o.width}x${o.height}`,
          safeZones ? `    Safe zones:\n${safeZones}` : undefined,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n');

    // Plans are context, not a requirement — the revise re-check critiques a
    // rendered doc without them.
    const planSummary = (payload.plans ?? [])
      .map((p) => {
        const slots = (p.slots ?? [])
          .map((s) => `        - ${s.id} (${s.kind}, role=${s.role})`)
          .join('\n');
        return [
          `  - variant ${p.variantId}: ${p.skill}`,
          `    concept: ${p.concept}`,
          `    slots:\n${slots}`,
        ].join('\n');
      })
      .join('\n\n');

    return `You are a meticulous visual-design critic reviewing a contact sheet of generated design variants.

Evaluate the contact sheet against this rubric:
${criteria}

Outputs and channel-safe zones:
${outputLines}

${planSummary ? `Design plans:\n${planSummary}` : ''}

Look at the contact sheet and identify concrete, actionable visual issues. For each issue, produce a finding with:
- "formatId" (optional): which output format is affected, if known.
- "slotId" (optional): which design slot is affected, if known.
- "issue": a short, specific description of the problem (e.g. "Bottom caption is too close to the Instagram Reel bottom-UI safe zone and may be covered by captions", "Headline text is too small to read at thumbnail size", "Light text on a bright background lacks contrast").
- "fix" (optional): an object describing the fix, with one of these shapes:
  - "scope": "shared" or "format-only"
  - "targetSlots": array of slot ids the fix applies to
  - "geometry": partial element geometry such as { x, y, width, height, fontSize }
  - "style": partial style such as { fill, stroke, opacity }
  - "text": { slotId, newText }
  - "note": free-text guidance when no numeric edit is possible

${VISION_CRITIC_SCHEMA_BLOCK}

If the contact sheet looks good, return { "findings": [] }.`;
  }

  private async _escalate(
    orgId: string,
    payload: CritiqueRequest,
    findings: VisionFinding[]
  ): Promise<VisionFinding[]> {
    const escalatedFormats = new Set<string>();
    const detailKeywords = ['small', 'tiny', 'illegible', 'detail', 'blur', 'low resolution', 'hard to read'];

    for (const f of findings) {
      const text = `${f.issue} ${f.fix?.note || ''}`.toLowerCase();
      if (detailKeywords.some((k) => text.includes(k)) && f.formatId) {
        escalatedFormats.add(f.formatId);
      }
    }

    if (escalatedFormats.size === 0) return [];

    const extra: VisionFinding[] = [];
    await Promise.all(
      (payload.outputPreviews || [])
        .filter((o) => escalatedFormats.has(o.formatId))
        .map(async (o) => {
          try {
            const imageUrl = await this._resolveImageUrl(orgId, o.url);
            if (!imageUrl) return;
            const prompt = `Review this full-resolution design for the "${o.formatId}" output. Focus on legibility, safe-zone compliance, and whether any text or important detail would be lost at real size. ${VISION_CRITIC_SCHEMA_BLOCK}; keep it brief.`;
            const raw = await this._aiDefaults.vision(orgId, imageUrl, prompt);
            const parsed = this._extractFindings(raw);
            for (const f of parsed) {
              if (!f.formatId) f.formatId = o.formatId;
              extra.push(f);
            }
          } catch (err) {
            this._logger.warn(
              `Escalated critique failed for ${o.formatId}: ${(err as Error).message}`
            );
          }
        })
    );

    return extra;
  }

  private _extractFindings(raw: string): VisionFinding[] {
    try {
      const parsed = this._extractJson(raw) as { findings?: unknown } | null;
      if (!parsed || !Array.isArray(parsed.findings)) {
        return [];
      }
      return parsed.findings
        .map((f) => this._normalizeFinding(f))
        .filter((f): f is VisionFinding => f !== null);
    } catch {
      return [];
    }
  }

  private _normalizeFinding(item: unknown): VisionFinding | null {
    if (!item || typeof item !== 'object') return null;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.issue !== 'string' || !candidate.issue.trim()) {
      return null;
    }

    const finding: VisionFinding = {
      issue: candidate.issue.trim(),
    };

    if (typeof candidate.formatId === 'string') {
      finding.formatId = candidate.formatId;
    }
    if (typeof candidate.slotId === 'string') {
      finding.slotId = candidate.slotId;
    }
    if (candidate.fix && typeof candidate.fix === 'object') {
      finding.fix = this._normalizeFix(candidate.fix as Record<string, unknown>);
    }

    return finding;
  }

  private _normalizeFix(raw: Record<string, unknown>): Fix {
    const scope: FixScope =
      raw.scope === 'format-only' || raw.scope === 'shared'
        ? (raw.scope as FixScope)
        : 'shared';

    const fix: Fix = { scope };

    if (Array.isArray(raw.targetSlots)) {
      const slots = raw.targetSlots.filter(
        (s): s is string => typeof s === 'string'
      );
      if (slots.length > 0) fix.targetSlots = slots;
    }

    // Sanitize to the Fix shape rather than casting: an off-shape key or a
    // string-typed number from the vision model must not ride into the strict
    // updateElement patch schema downstream.
    if (raw.geometry && typeof raw.geometry === 'object') {
      const src = raw.geometry as Record<string, unknown>;
      const geometry: NonNullable<Fix['geometry']> = {};
      for (const key of ['x', 'y', 'width', 'height', 'fontSize'] as const) {
        const value = src[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          geometry[key] = value;
        }
      }
      if (Object.keys(geometry).length > 0) fix.geometry = geometry;
    }

    if (raw.style && typeof raw.style === 'object') {
      const src = raw.style as Record<string, unknown>;
      const style: NonNullable<Fix['style']> = {};
      if (typeof src.fill === 'string') style.fill = src.fill;
      if (typeof src.stroke === 'string') style.stroke = src.stroke;
      if (typeof src.opacity === 'number' && Number.isFinite(src.opacity)) {
        style.opacity = Math.max(0, Math.min(1, src.opacity));
      }
      if (Object.keys(style).length > 0) fix.style = style;
    }

    if (
      raw.text &&
      typeof raw.text === 'object' &&
      typeof (raw.text as Record<string, unknown>).slotId === 'string' &&
      typeof (raw.text as Record<string, unknown>).newText === 'string'
    ) {
      fix.text = {
        slotId: (raw.text as Record<string, unknown>).slotId as string,
        newText: (raw.text as Record<string, unknown>).newText as string,
      };
    }

    if (typeof raw.note === 'string') {
      fix.note = raw.note;
    }

    return fix;
  }

  private _extractJson(raw: string): unknown {
    const trimmed = raw.trim();
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return JSON.parse(trimmed.slice(start, end + 1));
  }

  private async _resolveImageUrl(
    orgId: string,
    url: string
  ): Promise<string | null> {
    if (await isSafePublicHttpsUrl(url)) {
      return url;
    }

    if (!this._isLocalStorageUrl(url)) {
      this._logger.warn(
        `Vision critic skipping non-public, non-local image URL: ${url}`
      );
      return null;
    }

    try {
      const buffer = await readFile(this._localPathFromUrl(url));
      if (buffer.length > VISION_CRITIC_MAX_INLINE_BYTES) {
        this._logger.warn(
          'vision critic disabled: storage not provider-reachable'
        );
        return null;
      }
      const detected = await fromBuffer(buffer);
      const mime = detected?.mime || 'image/png';
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch (err) {
      this._logger.warn(
        `Vision critic failed to inline local image: ${(err as Error).message}`
      );
      return null;
    }
  }

  private _isLocalStorageUrl(url: string): boolean {
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    return (
      (frontendUrl && url.startsWith(`${frontendUrl}/uploads/`)) ||
      url.startsWith('/uploads/')
    );
  }

  private _localPathFromUrl(url: string): string {
    const frontendUrl = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
    let key = url;
    if (frontendUrl && key.startsWith(`${frontendUrl}/uploads/`)) {
      key = key.slice(`${frontendUrl}/uploads/`.length);
    } else if (key.startsWith('/uploads/')) {
      key = key.slice('/uploads/'.length);
    }
    const uploadDirectory = process.env.UPLOAD_DIRECTORY || './uploads';
    return path.join(uploadDirectory, key);
  }
}
