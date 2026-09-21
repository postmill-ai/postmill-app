import { Injectable, NestMiddleware, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { GuardrailService } from '@postmill-ai/nestjs-libraries/ai/governance/guardrail.service';
import { GuardrailViolation } from '@postmill-ai/nestjs-libraries/ai/governance/errors';

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

    // CopilotKit ≥1.69 single-route transport wraps the AG-UI run input in a
    // `{ method, params, body }` envelope; the messages live one level down.
    // Only the latest user turn is new input — assistant/tool messages are ours.
    const source =
      typeof body.method === 'string' && body.body && typeof body.body === 'object'
        ? {
            messages: (body.body.messages ?? []).filter((m: any) => m?.role === 'user'),
            context: body.body.context,
          }
        : body;

    if (source.messages && Array.isArray(source.messages)) {
      for (const m of source.messages) {
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

    if (source.context && typeof source.context === 'string') {
      messages.push(source.context);
    }

    return messages;
  }
}
