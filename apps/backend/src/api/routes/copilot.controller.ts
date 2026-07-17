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
import OpenAI from 'openai';
import {
  AnthropicAdapter,
  CopilotRuntime,
  EmptyAdapter,
  GoogleGenerativeAIAdapter,
  GroqAdapter,
  LangChainAdapter,
  OpenAIAdapter,
  copilotRuntimeNodeHttpEndpoint,
  copilotRuntimeNestEndpoint,
} from '@copilotkit/runtime';
import Anthropic from '@anthropic-ai/sdk';
import { Groq } from 'groq-sdk';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { Organization, User } from '@prisma/client';
import { MastraAgent } from '@ag-ui/mastra';
import { MastraService } from '@gitroom/nestjs-libraries/chat/mastra.service';
import { Request, Response } from 'express';
import { RequestContext } from '@mastra/core/di';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AuthorizationActions, Sections } from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { AIModelProvider } from '@gitroom/nestjs-libraries/ai/ai-model.provider';
import { GuardrailService } from '@gitroom/nestjs-libraries/ai/governance/guardrail.service';
import { TelemetryService } from '@gitroom/nestjs-libraries/ai/governance/telemetry.service';
import { FeatureFlagsService } from '@gitroom/nestjs-libraries/feature-flags';

export type ChannelsContext = {
  integrations: unknown[];
  media?: unknown[];
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
    private _guardrails: GuardrailService,
    private _telemetry: TelemetryService,
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

  private async _buildServiceAdapter(orgId?: string) {
    const resolved = await this._aiModelProvider.resolveConfigForScope('agent', orgId);

    if (!resolved) {
      throw new HttpException('AI is not configured for this organization. Go to Settings → AI to configure a provider.', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const rawAdapter = await this._buildRawServiceAdapter(resolved);
    return this._wrapServiceAdapter(rawAdapter, orgId, resolved.providerId, resolved.modelId);
  }

  private async _buildRawServiceAdapter(resolved: any) {
    const isOpenAICompatible = resolved.adapter.identifier === 'openai' ||
      resolved.adapter.identifier === 'gateway' ||
      resolved.adapter.credentialFields.some((f: any) => f.key === 'baseURL');

    if (!isOpenAICompatible) {
      if (resolved.adapter.identifier === 'anthropic') {
        if (!resolved.creds.apiKey) {
          throw new HttpException('AI provider credentials not configured', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return new AnthropicAdapter({
          model: resolved.modelId,
          anthropic: new Anthropic({ apiKey: resolved.creds.apiKey }),
        });
      }

      if (resolved.adapter.identifier === 'google') {
        if (!resolved.creds.apiKey) {
          throw new HttpException('AI provider credentials not configured', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return new GoogleGenerativeAIAdapter({
          model: resolved.modelId,
          apiKey: resolved.creds.apiKey,
        });
      }

      if (resolved.adapter.identifier === 'groq') {
        if (!resolved.creds.apiKey) {
          throw new HttpException('AI provider credentials not configured', HttpStatus.UNPROCESSABLE_ENTITY);
        }
        return new GroqAdapter({
          model: resolved.modelId,
          groq: new Groq({ apiKey: resolved.creds.apiKey }),
        });
      }

      try {
        const model = resolved.adapter.createLangchainModel(
          resolved.creds,
          resolved.modelId,
          resolved.defaultSurface?.temperature
            ? { temperature: resolved.defaultSurface.temperature }
            : undefined,
        );
        return new LangChainAdapter({
          chainFn: async ({ messages, tools }) => {
            const maybeToolModel =
              typeof (model as any).bindTools === 'function'
                ? (model as any).bindTools(tools)
                : model;
            if (typeof (maybeToolModel as any).stream === 'function') {
              return (maybeToolModel as any).stream(messages);
            }
            if (typeof (maybeToolModel as any).invoke === 'function') {
              return (maybeToolModel as any).invoke(messages);
            }
            throw new Error('Resolved LangChain model does not support stream() or invoke()');
          },
        });
      } catch (err) {
        throw new HttpException(
          `${resolved.adapter.name} is not supported by the CopilotKit runtime adapter: ${(err as Error).message}`,
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    const apiKey = resolved.creds.apiKey;
    if (!apiKey) {
      throw new HttpException(
        'AI provider credentials not configured',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    return new OpenAIAdapter({
      model: resolved.modelId,
      openai: new OpenAI({ apiKey, baseURL: resolved.creds.baseURL || undefined }) as any,
    });
  }

  /**
   * Wraps a CopilotKit service adapter so every `process()` call runs input
   * guardrails and is recorded in a telemetry span. Output guardrails are
   * intentionally omitted here: CopilotKit streams token-by-token to the client,
   * so intercepting the full response would require wrapping the runtime event
   * source in a provider-specific way; the Mastra/agent path uses the governed
   * model wrapper (AIModelProvider.governedLanguageModel) which does apply both
   * input and output guardrails.
   */
  private _wrapServiceAdapter(
    adapter: any,
    orgId: string | undefined,
    providerId: string,
    modelId: string,
  ): any {
    const originalProcess = adapter.process.bind(adapter);
    return new Proxy(adapter, {
      get: (target, prop, receiver) => {
        if (prop === 'process') {
          return async (request: any) => {
            const inputText = this._extractCopilotInputText(request.messages);
            if (inputText) {
              await this._guardrails.checkInput(inputText, { orgId });
            }
            return this._telemetry.startSpan(
              'copilot.generate',
              async (span) => {
                span.setAttribute(TelemetryService.ATTR_GEN_AI_SYSTEM, providerId);
                span.setAttribute(TelemetryService.ATTR_GEN_AI_REQUEST_MODEL, modelId);
                if (orgId) span.setAttribute('ai.organizationId', orgId);
                return originalProcess(request);
              },
              { 'ai.scope': 'agent' },
            );
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  private _extractCopilotInputText(messages: any[] | undefined): string {
    if (!Array.isArray(messages)) return '';
    return messages
      .filter((m: any) => typeof m.isTextMessage === 'function' && m.isTextMessage())
      .map((m: any) => m.content)
      .filter((content: any) => typeof content === 'string')
      .join('\n');
  }

  // CopilotKit fires a runtime-info handshake to /copilot/{chat,agent} as soon as
  // its provider mounts — which is on EVERY page (the global layout) plus the agent
  // builder. When AI isn't configured, _buildServiceAdapter throws 422, which
  // CopilotKit surfaces as a `runtime_info_fetch_failed` console error on every
  // navigation. Serve an EmptyAdapter in that case so the handshake succeeds (no
  // agents, no error); actual generation is gated by the UI when AI is unavailable.
  private async _serviceAdapterOrEmpty(orgId?: string) {
    try {
      return await this._buildServiceAdapter(orgId);
    } catch (err) {
      if (
        err instanceof HttpException &&
        err.getStatus() === HttpStatus.UNPROCESSABLE_ENTITY
      ) {
        return new EmptyAdapter();
      }
      throw err;
    }
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
      const serviceAdapter = await this._serviceAdapterOrEmpty(organization?.id);
      const copilotRuntimeHandler = copilotRuntimeNodeHttpEndpoint({
        endpoint: '/copilot/chat',
        runtime: new CopilotRuntime(),
        serviceAdapter,
      });

      this._reflectCredentialedCors(req, res);
      return copilotRuntimeHandler(req, res);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      Logger.warn('AI configuration not available, chat will not work');
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
      const serviceAdapter = await this._serviceAdapterOrEmpty(organization.id);
      const mastra = await this._mastraService.mastra();
      const requestContext = new RequestContext<ChannelsContext>();
      const properties = req?.body?.variables?.properties || {};
      requestContext.set('integrations', properties.integrations || []);
      requestContext.set(
        'media',
        Array.isArray(properties.media) ? properties.media : []
      );
      // NOTE: the `ag-ui` view context is set exclusively by `@ag-ui/mastra`
      // (`getLocalAgents` forwards the CopilotKit readable as `{ context }` and
      // overwrites `requestContext.set('ag-ui', …)` unconditionally). A manual set
      // here from `properties.agUiContext` was dead — the readable always won — so
      // the frontend transport leg and this set were both removed.

      requestContext.set('organization', JSON.stringify(organization));
      requestContext.set('user', JSON.stringify({ id: user.id }));
      requestContext.set('ui', 'true');
      requestContext.set('access', JSON.stringify({ mode: 'user' }));

      const agents = MastraAgent.getLocalAgents({
        resourceId: organization.id,
        mastra,
        requestContext: requestContext as any,
      });

      const runtime = new CopilotRuntime({
        agents: agents as any,
      });

      const copilotRuntimeHandler = copilotRuntimeNestEndpoint({
        endpoint: '/copilot/agent',
        runtime,
        serviceAdapter,
      });

      this._reflectCredentialedCors(req, res);
      return copilotRuntimeHandler(req, res);
    } catch (err) {
      if (err instanceof HttpException) throw err;
      Logger.warn('AI configuration not available, agent will not work');
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
    try {
      return await memory.recall({
        resourceId: organization.id,
        threadId,
      });
    } catch (err) {
      return { messages: [] };
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
