import {
  Controller,
  HttpCode,
  HttpException,
  Logger,
  NotFoundException,
  Param,
  Post,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { CommsConfigRepository } from '@postmill-ai/nestjs-libraries/comms/comms-config.repository';
import { CommsConfigService } from '@postmill-ai/nestjs-libraries/comms/comms-config.service';
import { CommsPlatformWebhookService } from '@postmill-ai/nestjs-libraries/comms/comms-platform-webhook.service';
import {
  inngest,
  isInngestEnabled,
} from '@postmill-ai/nestjs-libraries/inngest/inngest.client';

/**
 * Inbound comms webhooks (Slack Events API, Telegram, Discord Interactions,
 * LINE Messaging API). Unauthenticated by design — routed by the per-config
 * webhookToken URL segment and verified with each provider's signature scheme.
 * Any token/identifier mismatch is a uniform 404 (no oracle). The handler only
 * verifies + enqueues and responds immediately (Slack/Discord 3-second ack);
 * all real work (connect-code claims, agent turns) runs in the comms-inbound
 * Inngest function.
 */
@ApiTags('Comms Webhooks')
@Controller('/webhooks/comms')
export class CommsWebhooksController {
  private readonly _logger = new Logger(CommsWebhooksController.name);

  constructor(
    private _configs: CommsConfigRepository,
    private _configService: CommsConfigService,
    private _platform: CommsPlatformWebhookService,
  ) {}

  // Shared platform-app inbound. Declared BEFORE /:identifier/:token so the
  // literal 'platform' segment wins over the token route pattern.
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Post('/platform/:identifier')
  // Providers expect a plain 200 for challenge/ack responses (Slack documents
  // `200 OK` for url_verification); Nest's POST default is 201.
  @HttpCode(200)
  async handlePlatform(
    @Param('identifier') identifier: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const rawBody = req.rawBody ?? Buffer.from('');
    const headers = req.headers as unknown as Record<string, string | undefined>;
    const { events, ack } = await this._platform.handle(identifier, rawBody, headers);
    if (events.length > 0 && isInngestEnabled()) {
      await inngest.send(events);
    }
    return ack ?? { ok: true };
  }

  // Per-IP throttle. Slack/Telegram egress IPs are shared across workspaces
  // and DM traffic is chatty — 60/min would drop events under normal load.
  @Throttle({ default: { limit: 300, ttl: 60000 } })
  @Post('/:identifier/:token')
  @HttpCode(200)
  async handle(
    @Param('identifier') identifier: string,
    @Param('token') token: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    // Log every hit BEFORE any verification — a silently-failed signature or
    // unknown token is otherwise indistinguishable from "the platform never
    // called us" when diagnosing delivery from journalctl.
    this._logger.log(
      `${identifier} webhook hit (token route): ${req.rawBody?.length ?? 0} bytes`,
    );
    const config = await this._configs.getByWebhookToken(identifier, token);
    if (!config || !config.enabled) {
      this._logger.warn(`${identifier} webhook: unknown/disabled token — 404`);
      throw new NotFoundException();
    }

    let adapter;
    try {
      adapter = await this._configService.resolveAdapter(
        config.organizationId,
        identifier,
      );
    } catch {
      this._logger.warn(`${identifier} webhook: adapter resolution failed — 404`);
      throw new NotFoundException();
    }
    if (!adapter.verifyWebhook || !adapter.parseInbound) {
      this._logger.warn(`${identifier} webhook: adapter lacks webhook support — 404`);
      throw new NotFoundException();
    }

    const rawBody = req.rawBody ?? Buffer.from('');
    const headers = req.headers as unknown as Record<string, string | undefined>;

    if (!(await adapter.verifyWebhook(rawBody, headers))) {
      this._logger.warn(
        `${identifier} webhook: signature verification failed — 401 (org signing secret mismatch)`,
      );
      throw new HttpException('invalid signature', 401);
    }

    const messages = adapter.parseInbound(rawBody, headers);
    this._logger.log(
      `${identifier} webhook: ${messages.map((m) => m.kind).join(',') || 'empty'}`,
    );

    const events = messages
      .filter((m) => m.kind === 'message' && m.externalUserId && m.text)
      .map((m) => ({
        name: 'comms/inbound.message' as const,
        // Event-id dedupe: provider message id when present, else a content
        // hash — never a constant (a constant id black-holes later events).
        id: `comms-inbound:${config.id}:${
          m.messageId ??
          createHash('sha256')
            .update(`${m.externalUserId}:${m.text}:${Date.now()}`)
            .digest('hex')
        }`,
        data: {
          configId: config.id,
          organizationId: config.organizationId,
          identifier,
          externalUserId: m.externalUserId!,
          externalChannelId: m.externalChannelId,
          text: m.text!,
          messageId: m.messageId,
        },
      }));
    if (events.length > 0 && isInngestEnabled()) {
      await inngest.send(events);
    }

    // A challenge (Slack url_verification, Discord PING) or a message that
    // demands an interaction response (Discord slash command) carries its own
    // ack body — return the first one verbatim.
    const ack = messages.find((m) => m.ackResponse !== undefined)?.ackResponse;
    return ack ?? { ok: true };
  }
}
