import React from 'react';

// Single source of truth for the Settings left-rail items. Mirrors the pattern used by
// media/layout.tsx (a static array of { href, label, section, icon }) but adds a `gate`
// predicate so tier/permission-restricted items hide exactly as they did in the old
// SettingsPopup. Labels/descriptions carry i18n key+default and are resolved by the layout
// (this is a plain data module — no hooks at module scope).

export interface SettingsGateCtx {
  user: any;
  permissions: { hasPermission: (resource: string, action: string) => boolean };
  isGeneral: boolean;
  billingEnabled: boolean;
  showLogout: boolean;
}

export interface SettingsNavItem {
  key: string;
  href: string;
  labelKey: string;
  labelDefault: string;
  descKey: string;
  descDefault: string;
  section?: 'Workspace' | 'Automation' | 'Developer';
  icon: React.ReactNode;
  gate?: (ctx: SettingsGateCtx) => boolean;
}

export const SETTINGS_SECTION_ORDER = ['Workspace', 'Automation', 'Developer'];

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    key: 'subscription',
    href: '/settings/subscription',
    labelKey: 'subscription',
    labelDefault: 'Subscription',
    descKey: 'subscription_settings_description',
    descDefault:
      'Manage your plan, billing cycle, usage, and add-ons.',
    section: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>
    ),
    gate: ({ billingEnabled, isGeneral }) => billingEnabled && isGeneral,
  },
  {
    key: 'team',
    href: '/settings/team',
    labelKey: 'team',
    labelDefault: 'Team',
    descKey: 'teams_page_description',
    descDefault:
      'Invite teammates, create accounts, and manage who has access to your workspace.',
    section: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    ),
    gate: ({ user, isGeneral }) => (user?.tier?.team_members ?? 0) > 1 && isGeneral,
  },
  {
    key: 'broadcast',
    href: '/settings/broadcast',
    labelKey: 'broadcast',
    labelDefault: 'Broadcast',
    descKey: 'broadcast_description',
    descDefault: 'Send a message or announcement to everyone in your organization.',
    section: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></svg>
    ),
    gate: ({ permissions }) => permissions.hasPermission('notifications', 'manage'),
  },
  {
    key: 'channels',
    href: '/settings/channels',
    labelKey: 'channels',
    labelDefault: 'Channels',
    descKey: 'channels_settings_description',
    descDefault:
      'Connect your social media accounts so you can publish posts from Postmill. Choose a platform, follow the steps, and you are ready to post.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
    ),
  },
  {
    key: 'ai',
    href: '/settings/ai',
    labelKey: 'ai_llm',
    labelDefault: 'AI',
    descKey: 'ai_page_description',
    descDefault:
      'Set up the AI that helps you create content — connect a provider for writing and images, give it brand voices, and save prompts you reuse.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z"/><path d="M18.5 14l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/></svg>
    ),
  },
  {
    key: 'brands',
    href: '/settings/ai/brands',
    labelKey: 'brands',
    labelDefault: 'Brands',
    descKey: 'brands_settings_description',
    descDefault:
      'Create and manage brand voices so your AI-generated content stays on message.',
    section: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
    ),
    gate: ({ user }) => (user?.tier?.brand_kits ?? 0) > 0,
  },
  {
    key: 'shortlinks',
    href: '/settings/shortlinks',
    labelKey: 'shortlinks',
    labelDefault: 'Shortlinks',
    descKey: 'shortlinks_settings_description',
    descDefault:
      'Connect a link-shortening service so long URLs in your posts become short, trackable links.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
    ),
  },
  {
    key: 'content',
    href: '/settings/content',
    labelKey: 'content',
    labelDefault: 'Content',
    descKey: 'content_settings_description',
    descDefault:
      'Manage the tools that create and organize media for your posts. Connect AI media tools, stock libraries, saved post sets, and signatures.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 20 21" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M7.50008 3L6.66675 7.16667M13.3334 3L12.5001 7.16667M18.3334 7.16667H1.66675M5.66675 18H14.3334C15.7335 18 16.4336 18 16.9684 17.7275C17.4388 17.4878 17.8212 17.1054 18.0609 16.635C18.3334 16.1002 18.3334 15.4001 18.3334 14V7C18.3334 5.59987 18.3334 4.8998 18.0609 4.36502C17.8212 3.89462 17.4388 3.51217 16.9684 3.27248C16.4336 3 15.7335 3 14.3334 3H5.66675C4.26662 3 3.56655 3 3.03177 3.27248C2.56137 3.51217 2.17892 3.89462 1.93923 4.36502C1.66675 4.8998 1.66675 5.59987 1.66675 7V14C1.66675 15.4001 1.66675 16.1002 1.93923 16.635C2.17892 17.1054 2.56137 17.4878 3.03177 17.7275C3.56655 18 4.26662 18 5.66675 18Z"/></svg>
    ),
  },
  {
    key: 'vpn',
    href: '/settings/vpn',
    labelKey: 'vpn',
    labelDefault: 'VPN',
    descKey: 'vpn_settings_description',
    descDefault:
      'Route your posts through a private connection for extra security or to meet location rules.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
    ),
  },
  {
    key: 'storage',
    href: '/settings/storage',
    labelKey: 'file_storage',
    labelDefault: 'File Storage',
    descKey: 'storage_page_description',
    descDefault:
      'Choose where Postmill saves your uploaded files — use the built-in storage or connect your own cloud bucket — and see how much space you are using.',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>
    ),
  },
  {
    key: 'campaigns',
    href: '/campaigns',
    labelKey: 'campaigns',
    labelDefault: 'Campaigns',
    descKey: 'campaigns_settings_description',
    descDefault:
      'Organize posts, channels, files, and planning notes into campaigns.',
    section: 'Workspace',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2a2 2 0 0 0-1.66-.9H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z" /></svg>
    ),
    gate: ({ user }) => user?.tier?.campaigns === true,
  },
  {
    key: 'webhooks',
    href: '/settings/webhooks',
    labelKey: 'webhooks_1',
    labelDefault: 'Webhooks',
    descKey: 'webhooks_description',
    descDefault:
      'Get automatic notifications sent to your other apps when something happens in Postmill.',
    section: 'Automation',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2"/><path d="M6 17L3 2l3.05 2.66"/><path d="M16.54 6.76a3 3 0 0 1 3.05 3.64"/><path d="M6 17.01l-2.5 4.99"/></svg>
    ),
    gate: ({ user }) => !!user?.tier?.webhooks,
  },
  {
    key: 'autopost',
    href: '/settings/autopost',
    labelKey: 'auto_post',
    labelDefault: 'Auto Post',
    descKey: 'autopost_description',
    descDefault:
      'Automatically create posts from an RSS feed. Add a feed, pick channels, and Postmill will publish new items for you.',
    section: 'Automation',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
    ),
    gate: () => true,
  },
  {
    key: 'developers',
    href: '/settings/developers',
    labelKey: 'developers',
    labelDefault: 'Developers',
    descKey: 'developers_description',
    descDefault:
      'Build custom connections with Postmill. Create API keys, set up MCP clients, and manage OAuth apps.',
    section: 'Developer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
    ),
    gate: ({ user, isGeneral, showLogout }) =>
      !!user?.tier?.api && isGeneral && showLogout,
  },
  {
    key: 'approved-apps',
    href: '/settings/approved-apps',
    labelKey: 'approved_apps',
    labelDefault: 'Approved Apps',
    descKey: 'apps_you_have_authorized',
    descDefault: 'See which outside apps can access your Postmill account. Remove access anytime.',
    section: 'Developer',
    icon: (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 11 12 14 22 4"/></svg>
    ),
  },
];

export {
  LEGACY_TAB_TO_PATH,
  SETTINGS_DEFAULT_PATH,
} from '@gitroom/frontend/components/settings/settings-paths';
