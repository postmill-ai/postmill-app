// Shared fixture for the comms tab/modal specs — NOT a test file (vitest only
// picks up *.spec.* here), so importing it from both specs is safe.
export const commsConfigFixture = {
  providers: [
    {
      identifier: 'telegram',
      name: 'Telegram',
      enabled: true,
      isConfigured: true,
      credentialFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      ],
      credentialsSet: { botToken: true },
      webhookUrl: 'https://backend.example/webhooks/comms/telegram/tok',
      webhookRegistered: true,
      capabilities: { webhookInbound: true, webhookRegistration: true },
    },
    {
      identifier: 'slack',
      name: 'Slack',
      enabled: false,
      isConfigured: false,
      credentialFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
        { key: 'signingSecret', label: 'Signing Secret', type: 'password', required: true },
      ],
      credentialsSet: { botToken: false, signingSecret: false },
      capabilities: { webhookInbound: true, threads: true },
      version: 'v1',
    },
    {
      identifier: 'discord',
      name: 'Discord',
      enabled: true,
      isConfigured: true,
      credentialFields: [
        { key: 'botToken', label: 'Bot Token', type: 'password', required: true },
      ],
      credentialsSet: { botToken: true },
      webhookUrl: 'https://backend.example/webhooks/comms/discord/tok',
      webhookRegistered: false,
      webhookError: 'HTTP 401',
    },
  ],
  links: [
    {
      id: 'link-1',
      identifier: 'telegram',
      userId: 'user-1',
      userEmail: 'maya@solstice.demo',
      userName: 'Maya',
      status: 'pending',
      agentChatEnabled: true,
      categories: { post_failed: true },
    },
    {
      id: 'link-2',
      identifier: 'telegram',
      userId: 'user-2',
      userEmail: 'sam@solstice.demo',
      userName: 'Sam',
      status: 'linked',
      agentChatEnabled: true,
      categories: { post_failed: true, post_published: true },
    },
  ],
  members: [
    { id: 'user-1', email: 'maya@solstice.demo', name: 'Maya', roleKey: 'owner', disabled: false },
    { id: 'user-2', email: 'sam@solstice.demo', name: 'Sam', roleKey: 'member', disabled: false },
  ],
};
