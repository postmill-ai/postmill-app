// Plain (no-JSX) settings path helpers, safe to import from a server component (the
// /settings redirect shim) as well as client code.

// Legacy `?tab=` value → new settings path, for the /settings compat shim and any
// remaining deep-links (OAuth return URIs, bookmarks). Covers the old top-level tab keys
// and the former Content sub-tab aliases.
export const LEGACY_TAB_TO_PATH: Record<string, string> = {
  ai: '/settings/ai/llm-providers',
  channels: '/settings/channels',
  shortlinks: '/settings/shortlinks',
  vpn: '/settings/vpn',
  storage: '/settings/storage/providers',
  webhooks: '/settings/webhooks',
  autopost: '/settings/autopost',
  api: '/settings/developers',
  approved_apps: '/settings/approved-apps',
  broadcast: '/settings/broadcast',
  teams: '/settings/team',
  roles: '/settings/team',
  // Content + its former aliases
  content: '/settings/content/ai-media',
  media_providers: '/settings/content/ai-media',
  content_packs: '/settings/content/content-packs',
  sets: '/settings/content/sets',
  signatures: '/settings/content/signatures',
};

export const SETTINGS_DEFAULT_PATH = '/settings/channels';
