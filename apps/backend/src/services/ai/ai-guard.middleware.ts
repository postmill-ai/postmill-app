import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

@Injectable()
export class AiGuardMiddleware implements NestMiddleware {
  constructor(private readonly _guardrails: GuardrailService) {}

  // Input guardrail only — output guardrails are handled by AIModelProvider
  async use(req: Request, res: Response, next: NextFunction) {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method) || !req.body) {
      next();
      return;
    }

    const messages = this._extractMessages(req.body);
    if (messages.length === 0) {
      next();
      return;
    }

    for (const msg of messages) {
      try {
        await this._guardrails.checkInput(msg, { orgId: (req as any).org?.id });
      } catch (err) {
        if (err instanceof GuardrailViolation) {
          res.status(HttpStatus.FORBIDDEN).json({
            error: 'Request blocked by content guardrail',
            policy: err.policy,
          });
          return;
        }
        throw err;
      }
    }

    next();
  }

  private _extractMessages(body: any): string[] {
    const messages: string[] = [];

    if (body.messages && Array.isArray(body.messages)) {
      for (const m of body.messages) {
        if (typeof m.content === 'string') {
          messages.push(m.content);
        } else if (m.content && Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.type === 'text' && part.text) {
              messages.push(part.text);
            }
          }
        }
      }
    }

    if (body.context && typeof body.context === 'string') {
      messages.push(body.context);
    }

    return messages;
  }
}
