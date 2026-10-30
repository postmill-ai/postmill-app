import { describe, expect, it } from 'vitest';
import { mergePosterPoll } from './poster-selection';

describe('mergePosterPoll', () => {
  it('does not let an older poll overwrite a newer poster selection', () => {
    const requested = [
      { id: 'one', thumbnailUrl: '/generated-one.jpg', progress: 50 },
      { id: 'two', thumbnailUrl: '/generated-two.jpg', progress: 60 },
    ];
    const polled = [
      { id: 'one', thumbnailUrl: '/generated-one.jpg', progress: 100 },
      { id: 'two', thumbnailUrl: '/generated-two.jpg', progress: 100 },
    ];
    const current = [
      { id: 'one', thumbnailUrl: '/custom-one.jpg', progress: 50 },
      { id: 'two', thumbnailUrl: '/generated-two.jpg', progress: 60 },
    ];

    expect(mergePosterPoll(requested, polled, current)).toEqual([
      { id: 'one', thumbnailUrl: '/custom-one.jpg', progress: 100 },
      { id: 'two', thumbnailUrl: '/generated-two.jpg', progress: 100 },
    ]);
  });
});
