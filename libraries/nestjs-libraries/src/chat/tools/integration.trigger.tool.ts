import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, Logger } from '@nestjs/common';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import {
  parseOrg,
  requireRead,
} from '@gitroom/nestjs-libraries/chat/tools/tool.helpers';

@Injectable()
export class IntegrationTriggerTool implements AgentToolInterface {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}
  private readonly _logger = new Logger(IntegrationTriggerTool.name);
  private static readonly MAX_REFRESH_ATTEMPTS = 2;
  private static readonly MAX_OUTPUT_CHARS = 100_000;
  name = 'triggerTool';

  run() {
    return createTool({
      id: 'triggerTool',
      description: `After using the integrationSchema, we sometimes miss details we can\'t ask from the user, like ids.
      Sometimes this tool requires to user prompt for some settings, like a word to search for. methodName is required [input:callable-tools]`,
      mcp: {
        annotations: {
          title: 'Trigger Integration Tool',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        integrationId: z.string().describe('The id of the integration'),
        methodName: z
          .string()
          .describe(
            'The methodName from the `integrationSchema` functions in the tools array, required'
          ),
        dataSchema: z.array(
          z.object({
            key: z.string().describe('Name of the settings key to pass'),
            value: z.string().describe('Value of the key'),
          })
        ),
      }),
      // Provider payloads are NOT uniformly arrays; @mastra/core `validateToolOutput`
      // replaces non-conforming returns with a validation error AND strips undeclared
      // keys, so the schema must accept BOTH the plain-string error leg and any success
      // shape (array/object/scalar) — otherwise real successes get swallowed.
      outputSchema: z.union([
        z.object({ output: z.string() }),
        z.object({ output: z.any() }),
      ]),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const ctx = context as any;
        requireRead(ctx);
        this._logger.debug(`triggerTool ${JSON.stringify(inputData)}`);
        const organizationId = parseOrg(ctx).id;

        const getIntegration =
          await this._integrationService.getIntegrationById(
            organizationId,
            inputData.integrationId
          );

        if (!getIntegration) {
          return {
            output: 'Integration not found',
          };
        }

        const integrationProvider =
          this._integrationManager.getSocialIntegrationUnchecked(
            getIntegration.providerIdentifier,
            getIntegration.providerVersion ?? undefined
          )!;

        if (!integrationProvider) {
          return {
            output: 'Integration not found',
          };
        }

        const tools = this._integrationManager.getAllTools();
        if (
          // @ts-ignore
          !tools[integrationProvider.identifier].some(
            (p) => p.methodName === inputData.methodName
          ) ||
          // @ts-ignore
          !integrationProvider[inputData.methodName]
        ) {
          return { output: 'tool not found' };
        }

        for (
          let attempt = 1;
          attempt <= IntegrationTriggerTool.MAX_REFRESH_ATTEMPTS;
          attempt++
        ) {
          try {
            // @ts-ignore
            const load = await integrationProvider[inputData.methodName](
              getIntegration.token,
              inputData.dataSchema.reduce(
                (all: Record<string, string>, current: { key: string; value: string }) => ({
                  ...all,
                  [current.key]: current.value,
                }),
                {} as Record<string, string>
              ),
              getIntegration.internalId,
              getIntegration
            );

            // Cap uncapped provider payloads: only oversized ones get serialized +
            // truncated (a small array/object passes through untouched).
            const serialized = JSON.stringify(load);
            if (
              serialized &&
              serialized.length > IntegrationTriggerTool.MAX_OUTPUT_CHARS
            ) {
              return {
                output:
                  serialized.slice(
                    0,
                    IntegrationTriggerTool.MAX_OUTPUT_CHARS
                  ) + '…[truncated]',
              };
            }

            return { output: load };
          } catch (err) {
            if (err instanceof RefreshToken) {
              // Bound the refresh-retry loop: after the last attempt still throwing
              // RefreshToken, stop instead of spinning forever (10s per lap).
              if (attempt >= IntegrationTriggerTool.MAX_REFRESH_ATTEMPTS) {
                return {
                  output:
                    'The integration token kept expiring after a refresh; please reconnect the channel.',
                };
              }

              const data = await this._refreshIntegrationService.refresh(
                getIntegration
              );

              if (!data) {
                await this._integrationService.disconnectChannel(
                  organizationId,
                  getIntegration
                );
                return {
                  output:
                    'We had to disconnect the channel as the token expired',
                };
              }

              const { accessToken } = data;

              if (accessToken) {
                getIntegration.token = accessToken;

                if (integrationProvider.refreshWait) {
                  await timer(10000);
                }

                continue;
              }

              // A refresh that yields no accessToken must not fall through to the
              // generic "Unexpected error" — surface it explicitly.
              return {
                output:
                  'Token refresh did not return a new access token; please reconnect the channel.',
              };
            }
            return { output: 'Unexpected error' };
          }
        }

        // Unreachable safety net (the loop returns on every path).
        return { output: 'Unexpected error' };
      },
    });
  }
}
