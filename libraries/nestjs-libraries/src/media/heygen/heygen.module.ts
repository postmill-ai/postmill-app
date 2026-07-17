import { Module } from '@nestjs/common';
import { HeyGenService } from './heygen.service';

// HeyGenService depends only on services exported by the @Global DatabaseModule
// (org-media settings, media-job lifecycle, ai-settings, storage, file), so no imports.
@Module({
  providers: [HeyGenService],
  exports: [HeyGenService],
})
export class HeyGenModule {}
