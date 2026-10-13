import { Injectable } from '@nestjs/common';
import { DefaultsResolutionService } from '@postmill-ai/nestjs-libraries/ai/defaults/defaults-resolution.service';

@Injectable()
export class AiDesignerDefaultsGate {
  constructor(
    private readonly _defaultsResolution: DefaultsResolutionService,
  ) {}

  async missingDefaults(
    orgId: string
  ): Promise<{ blocked: boolean; missing: string[]; warnings: string[] }> {
    const required: Array<{ domain: 'ai'; category: string; label: string }> = [
      { domain: 'ai', category: 'vision', label: 'vision' },
      { domain: 'ai', category: 'high-reasoning', label: 'high-reasoning' },
      { domain: 'ai', category: 'low-reasoning', label: 'low-reasoning' },
    ];

    const missing: string[] = [];
    const warnings: string[] = [];
    for (const req of required) {
      const resolved = await this._defaultsResolution.resolve(
        req.domain,
        req.category,
        orgId,
      );
      if (!resolved) {
        missing.push(req.label);
      }
    }

    // Image generation is checked through the same resolution the asset
    // agent's `AiDefaultsService.textToImage` requires. With NO default at
    // all, every background silently degrades to a stock photo — block the
    // run start. A CONFIGURED default whose provider was disabled/removed
    // (the stored row survives) only warns: the run continues and the
    // per-slot stock fallback is disclosed in the delivery notes.
    const imageLabel = 'image generation (text-to-image)';
    const resolvedMedia = await this._defaultsResolution.resolve(
      'media',
      'text-to-image',
      orgId,
    );
    if (!resolvedMedia) {
      const stored = await this._defaultsResolution.storedDefault(
        'media',
        'text-to-image',
        orgId,
      );
      if (stored) {
        warnings.push(imageLabel);
      } else {
        missing.push(imageLabel);
      }
    }

    return { blocked: missing.length > 0, missing, warnings };
  }

  /**
   * Markdown chat copy for the blocked state (plan §11): name the missing
   * categories and route to Settings → AI → Model Defaults.
   */
  missingDefaultsMarkdown(missing: string[]): string {
    return (
      `**AI Designer isn't configured for this workspace.**\n\n` +
      `The following model default(s) are missing: **${missing.join(
        ', '
      )}**.\n\n` +
      `Set them under **Settings → AI → Model Defaults** and try again.`
    );
  }

  /**
   * Markdown chat copy for the warn-and-continue state: a default is
   * configured but no longer resolves, so this run degrades (disclosed in
   * the delivery notes) instead of blocking.
   */
  defaultsWarningMarkdown(warnings: string[]): string {
    return (
      `**Heads up — ${warnings.join(', ')} is configured but its provider ` +
      `is disabled or unavailable.**\n\n` +
      `This run will fall back to stock imagery where generation was planned. ` +
      `Re-enable the provider (or pick a different default) under ` +
      `**Settings → AI → Model Defaults**.`
    );
  }
}
