import { Global, Module } from '@nestjs/common';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsConfigService } from './comms-config.service';
import { CommsLinkService } from './comms-link.service';
import { CommsDeliveryService } from './comms-delivery.service';
import { CommsAgentActivity } from './comms-agent.activity';
import { CommsInboundService } from './comms-inbound.service';
import { CommsPlatformWebhookService } from './comms-platform-webhook.service';

// Comms provider adapters live in their own workspace packages and resolve
// through the ProviderKernel (ProviderResolutionService); they are not Nest
// providers here. Mirrors VpnModule.
@Global()
@Module({
  providers: [
    CommsConfigRepository,
    CommsLinkRepository,
    CommsConfigService,
    CommsLinkService,
    CommsDeliveryService,
    CommsAgentActivity,
    CommsInboundService,
    CommsPlatformWebhookService,
  ],
  exports: [
    CommsConfigRepository,
    CommsLinkRepository,
    CommsConfigService,
    CommsLinkService,
    CommsDeliveryService,
    CommsAgentActivity,
    CommsInboundService,
    CommsPlatformWebhookService,
  ],
})
export class CommsModule {}
