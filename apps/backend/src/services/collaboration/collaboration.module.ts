import { Module, Global } from '@nestjs/common';
import { CollaborationGateway } from './collaboration.gateway';

@Global()
@Module({
  providers: [CollaborationGateway],
  exports: [CollaborationGateway],
})
export class CollaborationModule {}
