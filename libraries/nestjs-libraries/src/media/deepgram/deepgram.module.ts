import { Module } from '@nestjs/common';
import { DeepgramService } from './deepgram.service';

// DeepgramService depends only on services exported by the @Global DatabaseModule
// (org-media settings, media-job lifecycle, storage, file, registry), so no imports.
@Module({
  providers: [DeepgramService],
  exports: [DeepgramService],
})
export class DeepgramModule {}
