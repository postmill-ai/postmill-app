import { Controller, Post, Body, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, IsOptional, IsIn } from 'class-validator';
import { Request } from 'express';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { GuardrailViolation } from '@gitroom/nestjs-libraries/ai/governance/errors';

class ModerateRequest {
  @IsString()
  content!: string;

  @IsOptional()
  @IsIn(['output', 'input'])
  direction?: 'output' | 'input' = 'output';
}

interface ModerateResponse {
  passed: boolean;
  warnings?: string[];
  redactedContent?: string;
}

@ApiTags('AI Moderation')
@Controller('/ai')
export class AiModerateController {
  constructor(private readonly _guardrails: GuardrailService) {}

  @Post('/moderate')
  @HttpCode(HttpStatus.OK)
  async moderate(@Body() body: ModerateRequest, @Req() req: Request): Promise<ModerateResponse> {
    const { content, direction = 'output' } = body;
    const orgId = (req as any).org?.id;

    let result: string;

    try {
      if (direction === 'input') {
        result = await this._guardrails.checkInput(content, { orgId });
      } else {
        result = await this._guardrails.checkOutput(content, { orgId });
      }
    } catch (err) {
      if (err instanceof GuardrailViolation) {
        return {
          passed: false,
          warnings: [err.message],
        };
      }
      throw err;
    }

    if (result !== content) {
      return {
        passed: true,
        warnings: ['Content was partially redacted'],
        redactedContent: result,
      };
    }

    return {
      passed: true,
    };
  }
}
