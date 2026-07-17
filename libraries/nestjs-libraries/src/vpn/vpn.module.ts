import { Global, Module } from '@nestjs/common';
import { OrgVpnConfigService } from './org-vpn-config.service';
import { VpnDispatcherService } from './vpn-dispatcher.service';
import { OrgVpnConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/vpn/org-vpn-config.repository';

// VPN provider adapters live in their own workspace packages and resolve through
// the ProviderKernel (ProviderResolutionService); they are not Nest providers here.
@Global()
@Module({
  providers: [
    OrgVpnConfigService,
    OrgVpnConfigRepository,
    VpnDispatcherService,
  ],
  exports: [
    OrgVpnConfigService,
    OrgVpnConfigRepository,
    VpnDispatcherService,
  ],
})
export class VpnModule {}
