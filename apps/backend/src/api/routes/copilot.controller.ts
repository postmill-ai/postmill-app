import {
  Logger,
  Controller,
  Get,
  Post,
  Req,
  Res,
  Query,
  Param,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import {
  CopilotRuntime,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNestEndpoint,
} from '@copilotkit/runtime';
import { BuiltInAgent } from '@copilotkit/runtime/v2';
import { GetOrgFromRequest } from '@postmill-ai/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@postmill-ai/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@postmill-ai/nestjs-libraries/chat/mastra.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@postmill-ai/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@postmill-ai/backend/services/auth/permissions/permission.exception.class';
import { AIModelProvider } from '@postmill-ai/nestjs-libraries/ai/ai-model.provider';
import { BudgetExceeded, GuardrailViolation } from '@postmill-ai/nestjs-libraries/ai/governance/errors';
import { FeatureFlagsService } from '@postmill-ai/nestjs-libraries/feature-flags';

export type AgentRequestContext = {
  // Set by @ag-ui/mastra from the CopilotKit readables, never by this controller.
  'ag-ui'?: string;
  organization: string;
  user: string;
  ui: string;
  access: string;
};

@Controller('/copilot')
export class CopilotController {
  constructor(
    private _mastraService: MastraService,
    private _aiModelProvider: AIModelProvider,
    private _featureFlagsService: FeatureFlagsService,
  ) {}

  // The CopilotKit runtime (GraphQL Yoga under the hood) writes its own
  // permissive `Access-Control-Allow-Origin: *`, overriding Nest's global CORS.
  // A wildcard is INVALID for credentialed (cookie) requests — the browser
  // blocks the response ("blocked by CORS policy"), which is exactly what the
  // frontend's `<CopilotKit credentials="include">` handshake sends. Reflect the
  // request origin + credentials so the credentialed request is allowed. Yoga
  // sets the header via res.setHeader / res.writeHead, so intercept both.
  private _reflectCredentialedCors(req: Request, res: Response) {
    const origin = req.headers.origin as string | undefined;
    if (!origin) return;
    const setHeader = res.setHeader.bind(res);
    const rewrite = (name: any, value: any): any =>
      String(name).toLowerCase() === 'access-control-allow-origin' && value === '*'
        ? origin
        : value;
    // Yoga may set the header via setHeader(...) or via a writeHead(status, {...})
    // headers object — cover both, swapping the wildcard for the request origin
    // and always asserting Allow-Credentials.
    (res as any).setHeader = (name: string, value: any) => {
      const v = rewrite(name, value);
      if (v !== value) setHeader('Access-Control-Allow-Credentials', 'true');
      return setHeader(name, v);
    };
    const writeHead = res.writeHead.bind(res);
    (res as any).writeHead = (statusCode: number, ...rest: any[]) => {
      const headers = rest.find((a) => a && typeof a === 'object');
      if (headers) {
        for (const k of Object.keys(headers)) headers[k] = rewrite(k, headers[k]);
        headers['Access-Control-Allow-Credentials'] = 'true';
      }
      return writeHead(statusCode, ...(rest as [any]));
    };
  }

  /**
   * The model behind `/copilot/chat`. Since @copilotkit/runtime 1.69 the
   * single-route transport never calls a service adapter's `process()` — it
   * runs an agent, so a runtime without `agents` auto-builds one from the
   * adapter and throws `CopilotApiDiscoveryError` when the adapter cannot
   * name its model (Sentry POSTMILL-APP-D: every LangChainAdapter provider).
   * Passing an explicit BuiltInAgent on the org's governed model sidesteps
   * the adapter zoo entirely and restores the gates the old `process()` proxy
   * used to apply: budget check + usage recording (`languageModel`) and prompt
   * guardrails + telemetry (`governedLanguageModel`).
   */
  private async _chatModel(orgId?: string) {
    await this._assertAgentConfigured(orgId);
    return this._aiModelProvider.governedLanguageModel('agent', orgId);
  }

  private async _assertAgentConfigured(orgId?: string) {
    const resolved = await this._aiModelProvider.resolveConfigForScope('agent', orgId);
    if (!resolved) {
      throw new HttpException('AI is not configured for this organization. Go to Settings → AI to configure a provider.', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  private _mapAiError(err: unknown, surface: string): void {
    if (err instanceof HttpException) throw err;
    if (err instanceof BudgetExceeded) {
      // `error: 'BudgetExceeded'` is what the frontend's ai-error-display keys on;
      // `message` carries the reason (org_budget_exceeded / provider_budget_exceeded).
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, error: 'BudgetExceeded', message: err.message },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (err instanceof GuardrailViolation) {
      throw new HttpException(err.message, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    Logger.warn(`AI configuration not available, ${surface} will not work: ${(err as Error)?.message}`);
  }

  @Post('/chat')
  @CheckPolicies([AuthorizationActions.Create, Sections.MCP])
  async chatAgent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization?: Organization,
  ) {
    if (this._featureFlagsService.isDisabled('agent')) {
      return res.status(422).json({ error: 'AI agent is disabled' });
    }

    try {
      const model = await this._chatModel(organization?.id);
      const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
        endpoint: '/copilot/chat',
        runtime: new CopilotRuntime({
          agents: { default: new BuiltInAgent({ model }) } as any,
        }),
      });

      this._reflectCredentialedCors(req, res);
      return copilotRuntimeHandler(req, res);
    } catch (err) {
      this._mapAiError(err, 'chat');
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'AI configuration not available' });
      return;
    }
  }

  @Post('/agent')
  @CheckPolicies([AuthorizationActions.Create, Sections.MCP])
  async agent(
    @Req() req: Request,
    @Res() res: Response,
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User
  ) {
    if (this._featureFlagsService.isDisabled('agent')) {
      return res.status(422).json({ error: 'AI agent is disabled' });
    }

    try {
      await this._assertAgentConfigured(organization.id);
      const mastra = await this._mastraService.mastra();
      const requestContext = new RequestContext<AgentRequestContext>();
      // Only the identity/access keys are set here. Page context (`ag-ui`) is
      // set exclusively by `@ag-ui/mastra` from the CopilotKit readables. The
      // former `integrations`/`media` keys came from the GraphQL-era
      // `body.variables.properties` envelope (gone since CopilotKit 1.69's
      // single-route transport) and were read by no tool — removed.
      requestContext.set('organization', JSON.stringify(organization));
      requestContext.set('user', JSON.stringify({ id: user.id }));
      requestContext.set('ui', 'true');
      requestContext.set('access', JSON.stringify({ mode: 'user' }));

      const agents = MastraAgent.getLocalAgents({
        resourceId: organization.id,
        mastra,
        requestContext: requestContext as any,
      });

      // No service adapter: with an explicit agents map the runtime ignores it
      // (the Mastra agent owns its model), and building one 500'd the providers
      // without a LangChain integration (azure, bedrock, vertex).
      const runtime = new CopilotRuntime({
        agents: agents as any,
      });

      const copilotRuntimeHandler = copilotRuntimeNestEndpoint({
        endpoint: '/copilot/agent',
        runtime,
      });

      this._reflectCredentialedCors(req, res);
      return copilotRuntimeHandler(req, res);
    } catch (err) {
      this._mapAiError(err, 'agent');
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'AI configuration not available' });
      return;
    }
  }

  @Get('/:thread/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.MCP])
  async getMessagesList(
    @GetOrgFromRequest() organization: Organization,
    @Param('thread') threadId: string
  ): Promise<any> {
    if (this._featureFlagsService.isDisabled('agent')) {
      return { messages: [] };
    }
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postmill').getMemory();
    // Distinguish "thread unknown to this org" (404) from a genuinely empty
    // history — otherwise the UI renders the new-chat welcome screen for a
    // conversation that is simply not visible to this org (cross-org link,
    // stale bookmark), which looks like data loss.
    // getThreadById's runtime honors resourceId (verified: wrong-org → null)
    // but the @mastra/memory 1.28 type stub only declares { threadId } — cast.
    const thread = await memory.getThreadById({
      threadId,
      resourceId: organization.id,
    } as { threadId: string });
    if (!thread) {
      throw new HttpException('Conversation not found', HttpStatus.NOT_FOUND);
    }
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
        // Default lastMessages only returns the tail — load a generous window so
        // reopened threads show real history, not just the last exchange.
        perPage: 100,
        page: 0,
      });
    } catch (err) {
      // Never swallow recall failures into an empty list (same welcome-screen
      // illusion) — log and surface a real error instead.
      Logger.error(
        `Failed to recall thread ${threadId}: ${(err as Error)?.message}`
      );
      throw new HttpException(
        'Failed to load conversation',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('/list')
  @CheckPolicies([AuthorizationActions.Create, Sections.MCP])
  async getList(
    @GetOrgFromRequest() organization: Organization,
    @Query('perPage') perPage?: string
  ) {
    if (this._featureFlagsService.isDisabled('agent')) {
      return { threads: [] };
    }
    const mastra = await this._mastraService.mastra();
    const memory = await mastra.getAgent('postmill').getMemory();
    const list = await memory.listThreads({
      filter: { resourceId: organization.id },
      perPage: Number(perPage) || 50,
      page: 0,
      orderBy: { field: 'createdAt', direction: 'DESC' },
    });

    return {
      threads: list.threads.map((p) => ({
        id: p.id,
        title: p.title,
      })),
    };
  }
}
