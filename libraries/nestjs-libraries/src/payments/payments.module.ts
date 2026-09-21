import { Global, Module } from '@nestjs/common';
import { PaymentsConfigService } from './payments-config.service';
import { PaymentsService } from './payments.service';

// Payment provider adapters live in their own workspace packages and resolve
// through the ProviderKernel; they are not Nest providers here. Mirrors CommsModule.
@Global()
@Module({
  providers: [PaymentsConfigService, PaymentsService],
  exports: [PaymentsConfigService, PaymentsService],
})
export class PaymentsModule {}
