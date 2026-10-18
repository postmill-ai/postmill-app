import { describe, it, expect } from 'vitest';
import {
  docWithVideoPosters,
  videoOutputToPosterOutput,
} from './video-poster';
import { DesignerDocService } from './designer-doc.service';
import type { VideoOutput } from './designer-doc.schema';

const makeVideoOutput = (over: Partial<VideoOutput> = {}): VideoOutput => ({
  id: 'out-v1',
  formatId: 'reels',
  name: 'Reels',
  width: 1080,
  height: 1920,
  fps: 30,
  durationMs: 10000,
  tracks: [
    {
      id: 'trk-img',
      type: 'image',
      clips: [
        {
          id: 'clip-bg',
          startMs: 0,
          endMs: 10000,
          src: 'https://example.com/bg.png',
          fileId: 'file-1',
          fitMode: 'cover',
          keyframes: [
            { tMs: 0, props: { x: 0, y: 0, width: 1080, height: 1920 } },
            { tMs: 10000, props: { x: -10, y: -10, width: 1100, height: 1950 } },
          ],
        },
      ],
    },
    {
      id: 'trk-text',
      type: 'text',
      clips: [
        {
          id: 'clip-headline',
          startMs: 0,
          endMs: 10000,
          text: 'Grand opening',
          x: 40,
          y: 200,
          width: 1000,
          height: 200,
          fontSize: 96,
          fill: '#ffffff',
          transitionIn: { type: 'fade', durationMs: 400 },
        },
        {
          id: 'clip-late',
          startMs: 6000,
          endMs: 10000,
          text: 'Late CTA',
          x: 40,
          y: 1500,
          width: 600,
          height: 120,
          fontSize: 48,
        },
      ],
    },
    {
      id: 'trk-shape',
      type: 'shape',
      clips: [
        {
          id: 'clip-plate',
          startMs: 0,
          endMs: 10000,
          shape: 'rect',
          x: 20,
          y: 180,
          width: 1040,
          height: 240,
          fill: '#000000',
          opacity: 0.4,
          borderRadius: 24,
        },
      ],
    },
    {
      id: 'trk-audio',
      type: 'audio',
      clips: [
        { id: 'clip-audio', startMs: 0, endMs: 10000, src: 'https://example.com/a.mp3' },
      ],
    },
    {
      id: 'trk-video',
      type: 'video',
      clips: [
        { id: 'clip-vid', startMs: 0, endMs: 5000, src: 'https://example.com/v.mp4' },
      ],
    },
  ],
  ...over,
});

describe('videoOutputToPosterOutput', () => {
  it('projects the t=0 state into a renderable image output', () => {
    const poster = videoOutputToPosterOutput(makeVideoOutput());
    expect(poster).toMatchObject({
      id: 'out-v1',
      formatId: 'reels',
      width: 1080,
      height: 1920,
    });
    const byId = new Map(poster.children.map((el) => [el.id, el]));

    // z-order follows track order: image, then text, then shape.
    expect(poster.children.map((el) => el.id)).toEqual([
      'clip-bg',
      'clip-headline',
      'clip-plate',
    ]);

    // Image clip → image element with media + fit carried.
    expect(byId.get('clip-bg')).toMatchObject({
      type: 'image',
      src: 'https://example.com/bg.png',
      fileId: 'file-1',
      fitMode: 'cover',
    });

    // Text clip → text element; the intro fade does NOT blank the poster.
    const headline = byId.get('clip-headline') as any;
    expect(headline).toMatchObject({
      type: 'text',
      text: 'Grand opening',
      fontSize: 96,
      fill: '#ffffff',
      opacity: 1,
    });

    // The clip entering at 6000ms is not in the t=0 frame.
    expect(byId.has('clip-late')).toBe(false);
    // Audio and video clips have no poster pixels (video needs the render
    // container's ffmpeg path).
    expect(byId.has('clip-audio')).toBe(false);
    expect(byId.has('clip-vid')).toBe(false);
  });

  it('a tMs=0 keyframe pins the poster box (Ken Burns start state)', () => {
    const poster = videoOutputToPosterOutput(makeVideoOutput());
    const bg = poster.children.find((el) => el.id === 'clip-bg')!;
    // The tMs=0 keyframe pins the box (equal to the canvas here).
    expect([bg.x, bg.y, bg.width, bg.height]).toEqual([0, 0, 1080, 1920]);
  });

  it('a clip with no box and no t=0 keyframe projects fullscreen', () => {
    const out = makeVideoOutput();
    delete (out.tracks[0].clips[0] as any).keyframes;
    const poster = videoOutputToPosterOutput(out);
    const bg = poster.children.find((el) => el.id === 'clip-bg')!;
    expect([bg.x, bg.y, bg.width, bg.height]).toEqual([0, 0, 1080, 1920]);
  });

  it('carries a color/gradient bg and defaults the flat background to black', () => {
    const poster = videoOutputToPosterOutput(
      makeVideoOutput({ bg: { type: 'color', color: '#112233' } })
    );
    expect(poster.bg).toEqual({ type: 'color', color: '#112233' });
    expect(poster.background).toBe('#112233');

    const noBg = videoOutputToPosterOutput(makeVideoOutput());
    expect(noBg.background).toBe('#000000');
  });

  it('hidden tracks are excluded', () => {
    const out = makeVideoOutput();
    out.tracks[1].hidden = true;
    const poster = videoOutputToPosterOutput(out);
    expect(poster.children.some((el) => el.id === 'clip-headline')).toBe(false);
  });

  it('the projection validates as a renderable image-mode doc', () => {
    const doc = {
      version: 8,
      mode: 'image',
      outputs: [videoOutputToPosterOutput(makeVideoOutput())],
    };
    const validated = new DesignerDocService().validate(doc);
    expect(validated.outputs[0].width).toBe(1080);
    expect(
      (validated.outputs[0] as any).children.map((el: any) => el.id)
    ).toEqual(['clip-bg', 'clip-headline', 'clip-plate']);
  });
});

describe('docWithVideoPosters', () => {  it('returns the same doc object when there are no video outputs', () => {
    const doc = {
      version: 8,
      mode: 'image',
      outputs: [
        {
          id: 'o1',
          formatId: 'ig',
          name: 'IG',
          width: 1080,
          height: 1080,
          background: '#fff',
          children: [],
        },
      ],
    } as any;
    expect(docWithVideoPosters(doc)).toBe(doc);
  });

  it('projects video outputs and leaves image outputs untouched', () => {
    const imageOut = {
      id: 'o1',
      formatId: 'ig',
      name: 'IG',
      width: 1080,
      height: 1080,
      background: '#fff',
      children: [],
    };
    const doc = {
      version: 8,
      mode: 'video',
      outputs: [makeVideoOutput(), imageOut as any],
    } as any;
    const projected = docWithVideoPosters(doc);
    expect('children' in projected.outputs[0]).toBe(true);
    expect(projected.outputs[1]).toBe(imageOut);
  });
});
