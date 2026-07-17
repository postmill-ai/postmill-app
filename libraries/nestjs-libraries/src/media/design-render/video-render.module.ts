import { Module } from '@nestjs/common';
import { VideoRenderService } from './video-render.service';
import { ChromiumFrameCaptureService } from './chromium-frame-capture.service';
import { FfmpegVideoEncoderService } from './ffmpeg-video-encoder.service';
import { PodmanRenderService } from './podman-render.service';

// AiSettingsService and EncryptionService are resolved from the @Global() DatabaseModule.
@Module({
  providers: [
    VideoRenderService,
    ChromiumFrameCaptureService,
    FfmpegVideoEncoderService,
    PodmanRenderService,
  ],
  exports: [
    VideoRenderService,
    ChromiumFrameCaptureService,
    FfmpegVideoEncoderService,
    PodmanRenderService,
  ],
})
export class VideoRenderModule {}
