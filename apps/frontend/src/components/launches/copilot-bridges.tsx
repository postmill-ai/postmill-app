'use client';

import { FC } from 'react';
import { useCopilotAction, useCopilotReadable } from '@copilotkit/react-core';

/**
 * CopilotKit context bridges for the composer.
 *
 * The `useCopilotReadable` / `useCopilotAction` hooks must run inside a
 * `<CopilotKit>` provider — but the provider is only mounted when the org has
 * an active AI provider (see use-ai-active.ts + layout.component.tsx). Calling
 * those hooks unconditionally would throw "wrap your app in <CopilotKit>" on
 * every /posts render when AI is off.
 *
 * So the hook usage lives here, in components the parent renders ONLY when AI
 * is active (`{aiActive && <...Bridge />}`). When AI is off, these never
 * render, no copilot hook runs, and there is no provider to require.
 *
 * They render nothing — they only register readables/actions with CopilotKit.
 */

export const EditorCopilotBridge: FC<{
  items: { content: string }[];
  setValue: (value: string[]) => void;
}> = ({ items, setValue }) => {
  useCopilotReadable({
    description: 'Current content of posts',
    value: items.map((p) => p.content),
  });

  useCopilotAction({
    name: 'setPosts',
    description: 'a thread of posts',
    parameters: [
      {
        name: 'content',
        type: 'string[]',
        description: 'a thread of posts',
      },
    ],
    handler: async ({ content }) => {
      setValue(content);
    },
  });

  return null;
};

export const PickPlatformCopilotBridge: FC<{
  isMain: boolean;
  integrations: unknown;
  handler: (args: { integrationsId: string[] }) => void | Promise<void>;
  deps: unknown[];
}> = ({ isMain, integrations, handler, deps }) => {
  useCopilotReadable({
    description: isMain
      ? 'All available platforms channels'
      : 'Possible platforms channels to edit',
    value: JSON.stringify(integrations),
  });

  useCopilotAction(
    {
      name: isMain ? `addOrRemovePlatform` : 'setSelectedIntegration',
      description: isMain
        ? `Add or remove channels to schedule your post to, pass all the ids as array`
        : 'Set selected integrations',
      parameters: [
        {
          name: 'integrationsId',
          type: 'string[]',
          description: 'List of integrations id to set as selected',
          required: true,
        },
      ],
      handler,
    },
    deps
  );

  return null;
};
