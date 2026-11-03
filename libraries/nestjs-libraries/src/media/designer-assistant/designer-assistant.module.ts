import { Module } from '@nestjs/common';
import { DesignerAssistantService } from './designer-assistant.service';

@Module({
  providers: [DesignerAssistantService],
  exports: [DesignerAssistantService],
})
export class DesignerAssistantModule {}
