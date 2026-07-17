import { Module } from '@nestjs/common';
import { MediaStudioService } from './media-studio.service';

// MediaStudioService depends only on services exported by the @Global DatabaseModule
// (org-media settings, media-job lifecycle, ai-settings, storage, file) and the
// @Global ProviderResolutionService, so no imports are needed here.
@Module({
  providers: [MediaStudioService],
  exports: [MediaStudioService],
})
export class MediaStudioModule {}
