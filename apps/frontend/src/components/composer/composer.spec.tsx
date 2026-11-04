import 'reflect-metadata';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExistingDataContextProvider } from '@postmill-ai/frontend/components/launches/helpers/use.existing.data';
import { Composer } from './composer';
import { useLaunchStore } from './store';

vi.mock('@postmill-ai/helpers/utils/custom.fetch', () => ({
  useFetch: () => vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@postmill-ai/frontend/components/composer/manage.modal', () => ({
  ManageModal: () => null,
}));

vi.mock('@postmill-ai/frontend/components/layout/loading', () => ({
  LoadingComponent: () => null,
}));

const channel = {
  id: 'channel-1',
  identifier: 'x',
  name: 'Test channel',
  additionalSettings: '[]',
  editor: 'normal',
} as any;

const existingData = {
  integration: channel.id,
  settings: {},
  posts: [
    {
      id: 'post-1',
      content: 'Loaded existing content',
      delay: 0,
      image: [],
      tags: [],
    },
  ],
};

const renderComposer = () =>
  render(
    <ExistingDataContextProvider value={existingData}>
      <Composer allIntegrations={[channel]} integrations={[channel]} />
    </ExistingDataContextProvider>
  );

const expectLoadedPost = async () => {
  await waitFor(() => {
    expect(useLaunchStore.getState().internal).toEqual([
      expect.objectContaining({
        integration: channel,
        integrationValue: [
          expect.objectContaining({
            id: 'post-1',
            content: '<p>Loaded existing content</p>',
          }),
        ],
      }),
    ]);
  });
};

describe('Composer existing-data initialization', () => {
  beforeEach(() => {
    useLaunchStore.getState().reset();
  });

  afterEach(() => {
    cleanup();
    useLaunchStore.getState().reset();
  });

  it('preserves loaded posts when the store is cold', async () => {
    renderComposer();

    await expectLoadedPost();
    expect(useLaunchStore.getState().selectedIntegrations).toHaveLength(1);
  });

  it('preserves loaded posts when a stale selection mounts the editor first', async () => {
    useLaunchStore
      .getState()
      .addOrRemoveSelectedIntegration({ ...channel, id: 'channel-2' }, {});

    renderComposer();

    await expectLoadedPost();
    expect(
      useLaunchStore
        .getState()
        .selectedIntegrations.some((item) => item.integration.id === channel.id)
    ).toBe(true);
  });
});
