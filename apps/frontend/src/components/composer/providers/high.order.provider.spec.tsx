import 'reflect-metadata';
import React from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLaunchStore } from '@postmill-ai/frontend/components/composer/store';
import { PostComment } from '@postmill-ai/frontend/components/composer/providers/post-comment.enum';
import { withProvider } from './high.order.provider';

const fetchMock = vi.fn();

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => fetchMock,
}));

vi.mock('swr', () => ({
  default: () => ({ data: { internalPlugs: [] }, isLoading: false }),
}));

vi.mock('@postmill-ai/react/translation/get.transation.service.client', () => ({
  useT: () => (_key: string, fallback: string) => fallback,
}));

vi.mock('@postmill-ai/frontend/components/launches/general.preview.component', () => ({
  GeneralPreviewComponent: () => <div data-testid="preview" />,
}));

vi.mock('@postmill-ai/frontend/components/composer/providers/channel.global.plugs', () => ({
  ChannelGlobalPlugs: () => null,
}));

vi.mock('@postmill-ai/frontend/components/launches/internal.channels', () => ({
  InternalChannels: () => null,
}));

vi.mock('@postmill-ai/react/helpers/safe.image', () => ({
  default: () => null,
}));

const channel = {
  id: 'channel-1',
  identifier: 'x',
  name: 'Test channel',
  picture: null,
  additionalSettings: '[]',
  editor: 'normal',
} as any;

const TestProvider = withProvider({
  postComment: PostComment.ALL,
  minimumCharacters: [],
  SettingsComponent: null,
  maximumCharacters: 100,
});

const selectChannel = () => {
  useLaunchStore.getState().addOrRemoveSelectedIntegration(channel, {});
};

describe('withProvider selection lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLaunchStore.getState().reset();
    useLaunchStore.getState().setAllIntegrations([channel]);
    useLaunchStore.getState().setDummy(true);
    selectChannel();
  });

  afterEach(() => {
    cleanup();
    useLaunchStore.getState().reset();
  });

  it('unmounts cleanly when its channel is removed and can be selected again', () => {
    const { container } = render(<TestProvider id={channel.id} />);
    expect(container.firstChild).not.toBeNull();

    act(() => selectChannel());
    expect(container.firstChild).toBeNull();

    act(() => selectChannel());
    expect(container.firstChild).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
