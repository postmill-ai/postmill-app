import React, { FC, useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// The bridge module imports `useCopilotReadable`; stub it so the pure
// context-store functions can be tested without a CopilotKit provider.
vi.mock('@copilotkit/react-core', () => ({
  useCopilotReadable: () => undefined,
}));

import {
  getAgentUiContext,
  setAgentUiContext,
  pushAgentUiContext,
} from './agent-context-bridge';

// A minimal producer, mirroring how launches / campaigns / post-detail wire the
// bridge: push on mount, return the disposer so it flags the snapshot stale on
// unmount (2.3 — producers never co-mount with the agent chat).
const Producer: FC<{ ctx: Parameters<typeof pushAgentUiContext>[0] }> = ({ ctx }) => {
  useEffect(() => pushAgentUiContext(ctx), [ctx]);
  return null;
};

describe('agent-context-bridge', () => {
  beforeEach(() => {
    cleanup();
    setAgentUiContext({});
  });

  it('keeps the contributed keys and marks them stale on dispose', () => {
    // Producers never co-mount with the /agents bridge, so a hard delete would
    // always leave the store empty. The snapshot must survive unmount, flagged
    // stale via `leftViewAt` instead of deleted.
    const dispose = pushAgentUiContext({ view: 'launches', calendarWeek: 'wk' });
    expect(getAgentUiContext()).toEqual({ view: 'launches', calendarWeek: 'wk' });
    dispose();
    const after = getAgentUiContext();
    expect(after.view).toBe('launches');
    expect(after.calendarWeek).toBe('wk');
    expect(typeof after.leftViewAt).toBe('string');
  });

  it('clears the stale marker when a fresh producer mounts (current view wins)', () => {
    const dispose = pushAgentUiContext({ view: 'launches' });
    dispose();
    expect(getAgentUiContext().leftViewAt).toBeTruthy();

    // A new view mounting is the live context now — leftViewAt must be gone.
    pushAgentUiContext({ view: 'campaigns', selectedCampaignId: 'c1' });
    const ctx = getAgentUiContext();
    expect(ctx.leftViewAt).toBeUndefined();
    expect(ctx.view).toBe('campaigns');
    expect(ctx.selectedCampaignId).toBe('c1');
  });

  it('merges sibling producers (modal contributes currentPostId on top)', () => {
    pushAgentUiContext({ view: 'launches', visiblePostIds: ['p1'] });
    pushAgentUiContext({ currentPostId: 'p1' });
    expect(getAgentUiContext()).toEqual({
      view: 'launches',
      visiblePostIds: ['p1'],
      currentPostId: 'p1',
    });
  });

  it('persists the last-view snapshot after the producer unmounts', () => {
    const { unmount } = render(<Producer ctx={{ selectedCampaignId: 'c1' }} />);
    expect(getAgentUiContext()).toEqual({ selectedCampaignId: 'c1' });
    unmount();
    const ctx = getAgentUiContext();
    expect(ctx.selectedCampaignId).toBe('c1');
    expect(typeof ctx.leftViewAt).toBe('string');
  });
});
