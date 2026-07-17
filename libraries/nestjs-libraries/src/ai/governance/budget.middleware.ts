import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AiSettingsManager } from '@gitroom/nestjs-libraries/ai/ai-settings.manager';
import { BudgetService } from './budget.service';

function parseScopeFromPath(path: string): string | null {
  if (path.includes('/mcp/') || path.endsWith('/mcp')) return 'mcp';
  if (path.startsWith('/api/agents') || path.startsWith('/agents') || path === '/posts/generator') return 'generator';
  if (path.includes('/copilot/')) return 'agent';
  if (path.includes('/rag/backfill')) return 'backfill';
  if (path.startsWith('/ai/')) return 'utility';
  return null;
}

@Injectable()
export class BudgetMiddleware implements NestMiddleware {
  private readonly _logger = new Logger(BudgetMiddleware.name);

  constructor(
    private readonly _aiSettingsManager: AiSettingsManager,
    private readonly _budgetService: BudgetService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const settings = await this._aiSettingsManager.getSettings();
    const budgetSettings = settings?.budgetSettings as
      | { monthlyCap?: number; dailyCap?: number; perOrgCaps?: Record<string, any>; scopeCaps?: Record<string, any> }
      | undefined;

    if (
      !budgetSettings?.monthlyCap &&
      !budgetSettings?.dailyCap &&
      !budgetSettings?.perOrgCaps &&
      !budgetSettings?.scopeCaps
    ) {
      this._logger.debug(
        `[BudgetMiddleware] No budget caps configured — pass-through for ${req.method} ${req.path}`,
      );
      next();
      return;
    }

    const scope = parseScopeFromPath(req.path);
    if (!scope) {
      this._logger.debug(
        `[BudgetMiddleware] Unrecognised scope for ${req.path} — pass-through`,
      );
      next();
      return;
    }

    const orgId =
      (req as any).org?.id ??
      (req.headers['x-org-id'] as string | undefined);

    const result = await this._budgetService.checkBudget(scope, orgId);
    if (!result.allowed) {
      this._logger.warn(
        `Budget exceeded for scope="${scope}" orgId="${orgId}": ${result.reason}`,
      );
      res.status(429).json({
        statusCode: 429,
        error: 'BudgetExceeded',
        message: result.reason,
      });
      return;
    }

    next();
  }

}
