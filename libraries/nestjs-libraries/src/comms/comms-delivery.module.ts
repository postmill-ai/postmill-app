import { Global, Module } from '@nestjs/common';
import { CommsConfigRepository } from './comms-config.repository';
import { CommsLinkRepository } from './comms-link.repository';
import { CommsConfigService } from './comms-config.service';
import { CommsDeliveryService } from './comms-delivery.service';

@Global()
@Module({
  providers: [
    CommsConfigRepository,
    CommsLinkRepository,
    CommsConfigService,
    CommsDeliveryService,
  ],
  exports: [
    CommsConfigRepository,
    CommsLinkRepository,
    CommsConfigService,
    CommsDeliveryService,
  ],
})
export class CommsDeliveryModule {}
