import { Injectable } from '@nestjs/common';
import { DefaultsResolutionService } from '@gitroom/nestjs-libraries/ai/defaults/defaults-resolution.service';

@Injectable()
export class AiDesignerDefaultsGate {
  constructor(
    private readonly _defaultsResolution: DefaultsResolutionService,
  ) {}

  async missingDefaults(
    orgId: string
  ): Promise<{ blocked: boolean; missing: string[] }> {
    const required: Array<{ domain: 'ai'; category: string; label: string }> = [
      { domain: 'ai', category: 'vision', label: 'vision' },
      { domain: 'ai', category: 'high-reasoning', label: 'high-reasoning' },
      { domain: 'ai', category: 'low-reasoning', label: 'low-reasoning' },
    ];

    const missing: string[] = [];
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

    return { blocked: missing.length > 0, missing };
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
}
