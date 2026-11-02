import { Global, Module } from '@nestjs/common';
import { CommsDeliveryModule } from './comms-delivery.module';
import { CommsLinkService } from './comms-link.service';
import { CommsAgentActivity } from './comms-agent.activity';
import { CommsInboundService } from './comms-inbound.service';
import { CommsPlatformWebhookService } from './comms-platform-webhook.service';

// Comms provider adapters live in their own workspace packages and resolve
// through the ProviderKernel (ProviderResolutionService); they are not Nest
// providers here. Mirrors VpnModule.
@Global()
@Module({
  imports: [CommsDeliveryModule],
  providers: [
    CommsLinkService,
    CommsAgentActivity,
    CommsInboundService,
    CommsPlatformWebhookService,
  ],
  exports: [
    CommsDeliveryModule,
    CommsLinkService,
    CommsAgentActivity,
    CommsInboundService,
    CommsPlatformWebhookService,
  ],
})
export class CommsModule {}
