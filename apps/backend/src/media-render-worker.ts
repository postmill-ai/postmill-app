/**
 * Render-worker CLI — the container entrypoint for the Podman render path.
 *
 * Runs ONE local video render (Designer timeline encode OR clip-merge) end-to-end and
 * writes the artifact(s) into `<workdir>/out`. Reuses the same encode/merge code as the
 * in-process path by instantiating the (DI-light) services directly — no Nest bootstrap.
 *
 * Invoked as: `node media-render-worker.js /work/job.json`
 * (the image ENTRYPOINT is this file; `/work` is the mounted job workdir).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ChromiumFrameCaptureService } from '@gitroom/nestjs-libraries/media/design-render/chromium-frame-capture.service';
import { FfmpegVideoEncoderService } from '@gitroom/nestjs-libraries/media/design-render/ffmpeg-video-encoder.service';
import { mergeLocalFiles } from '@gitroom/nestjs-libraries/media/replicate-studio/video-merge';
import {
  RenderJobSpec,
  RENDER_OUTPUT_DIR,
  RENDER_THUMBNAIL_NAME,
  renderOutputName,
} from '@gitroom/nestjs-libraries/media/design-render/render-job-spec';

async function main(): Promise<void> {
  const jobFile = process.argv[2];
  if (!jobFile) {
    console.error('usage: media-render-worker <job.json>');
    process.exit(2);
  }

  const workDir = path.dirname(jobFile);
  const outDir = path.join(workDir, RENDER_OUTPUT_DIR);
  fs.mkdirSync(outDir, { recursive: true });

  const spec = JSON.parse(fs.readFileSync(jobFile, 'utf8')) as RenderJobSpec;

  if (spec.op === 'design') {
    // The in-container Chromium + audio fetch resolve asset/route URLs against this base.
    if (spec.baseUrl) {
      process.env.NEXT_PUBLIC_BACKEND_URL = spec.baseUrl;
    }
    const encoder = new FfmpegVideoEncoderService(new ChromiumFrameCaptureService());
    const result = await encoder.encode(spec.composition, spec.options);
    fs.copyFileSync(
      result.videoPath,
      path.join(outDir, renderOutputName(spec.options.format)),
    );
    if (fs.existsSync(result.thumbnailPath)) {
      fs.copyFileSync(result.thumbnailPath, path.join(outDir, RENDER_THUMBNAIL_NAME));
    }
    encoder.cleanup(path.dirname(result.videoPath));
    return;
  }

  if (spec.op === 'merge') {
    const inputs = spec.files.map((f) => ({
      path: path.join(workDir, f.name),
      trimStart: f.trimStart,
      trimEnd: f.trimEnd,
    }));
    await mergeLocalFiles(inputs, spec.transitions, workDir, path.join(outDir, 'output.mp4'));
    return;
  }

  console.error(`unknown render op: ${(spec as { op?: string }).op}`);
  process.exit(2);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error((err as Error)?.stack || String(err));
    process.exit(1);
  });
