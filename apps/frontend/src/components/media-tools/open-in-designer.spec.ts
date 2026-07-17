import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openInDesigner } from './open-in-designer';

const TIMELINE_KEY = 'designer:timeline-handoff';

describe('openInDesigner', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('routes a HeyGen avatar render onto the video timeline (avatar → video)', () => {
    const navigate = vi.fn();
    openInDesigner(
      { operation: 'avatar', artifactUrl: 'https://cdn.example/v.mp4', fileId: 'f1' },
      navigate
    );
    expect(navigate).toHaveBeenCalledWith('/media/designer?timeline=1');
    const handoff = JSON.parse(window.sessionStorage.getItem(TIMELINE_KEY)!);
    expect(handoff).toMatchObject({ type: 'video', url: 'https://cdn.example/v.mp4', fileId: 'f1' });
  });

  it('sends audio to the timeline as audio', () => {
    const navigate = vi.fn();
    openInDesigner({ operation: 'audio', artifactUrl: 'https://cdn.example/a.mp3' }, navigate);
    const handoff = JSON.parse(window.sessionStorage.getItem(TIMELINE_KEY)!);
    expect(handoff.type).toBe('audio');
  });

  it('routes an image to the static canvas (no timeline handoff)', () => {
    const navigate = vi.fn();
    openInDesigner({ operation: 'image', artifactUrl: 'https://cdn.example/i.png' }, navigate);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/media/designer?url='));
    expect(window.sessionStorage.getItem(TIMELINE_KEY)).toBeNull();
  });

  it('ignores non-media operations and missing artifacts', () => {
    const navigate = vi.fn();
    openInDesigner({ operation: 'stt', artifactUrl: 'https://cdn.example/t.txt' }, navigate);
    openInDesigner({ operation: 'video', artifactUrl: null }, navigate);
    expect(navigate).not.toHaveBeenCalled();
  });
});
