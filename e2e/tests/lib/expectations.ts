/**
 * Expectations-driven gap detection.
 *
 * A generic crawler finds dead buttons and empty pages, but it CANNOT catch an action that
 * *should* exist and simply isn't there (e.g. the Teams tab renders, but there's no working
 * "invite member", no member CRUD, no clickable profile — incomplete and just wrong).
 *
 * So each feature area declares the controls/data a *working* version must expose. The
 * `41-feature-gaps` spec navigates to each, then asserts presence; anything missing is a GAP
 * (a real product bug), anything present-but-disabled is a DEAD action. This is how we surface
 * "where data is missing, where actions are missing, where things just aren't right."
 *
 * `find` strategies (any one matching = present):
 *   - role+name via getByRole
 *   - text via getByText
 *   - css via locator
 */

export interface ExpectedControl {
  what: string; // human description of the control/data
  // At least one of these locating strategies must find a VISIBLE element.
  role?: 'button' | 'link' | 'tab' | 'textbox' | 'combobox' | 'checkbox';
  name?: RegExp; // accessible name for role, or text for getByText
  text?: RegExp; // getByText fallback
  css?: string; // raw locator fallback
  // If true, presence alone isn't enough — it must also be enabled/clickable.
  mustBeEnabled?: boolean;
  // If true, this is a known-suspect area; absence is reported but not a hard fail.
  soft?: boolean;
}

export interface FeatureExpectation {
  area: string;
  // How to reach the surface: a route, optionally then a tab/section click.
  route: string;
  // Optional: a settings/analytics tab to open first (by visible label).
  openTab?: RegExp;
  controls: ExpectedControl[];
}

export const FEATURE_EXPECTATIONS: FeatureExpectation[] = [
  // ---- The user's canonical example: Teams is incomplete/wrong ----
  {
    area: 'Settings → Teams',
    route: '/settings',
    openTab: /^teams$/i,
    controls: [
      { what: 'Invite member control (button or email input)', name: /invite|add member|add team/i, mustBeEnabled: true },
      { what: 'Email input to invite', role: 'textbox', name: /email/i, soft: true },
      { what: 'Role selector for invited member', role: 'combobox', soft: true },
      { what: 'At least one existing team member listed', text: /member|owner|admin|@/i, soft: true },
      { what: 'Per-member action (remove/edit/view profile)', name: /remove|delete|edit|view|profile/i, soft: true },
    ],
  },
  {
    area: 'Settings → Webhooks',
    route: '/settings',
    openTab: /^webhooks$/i,
    controls: [
      { what: 'Add webhook', name: /add|create|new webhook/i, mustBeEnabled: true },
      { what: 'Webhook URL input', role: 'textbox', soft: true },
    ],
  },
  {
    area: 'Settings → Developers (API keys)',
    route: '/settings',
    openTab: /developers|api/i,
    controls: [
      { what: 'Generate/create API key', name: /generate|create|new key|add key/i, mustBeEnabled: true, soft: true },
    ],
  },
  {
    area: 'Settings → Global (profile)',
    route: '/settings',
    openTab: /global settings|profile/i,
    controls: [
      { what: 'Name input', role: 'textbox', soft: true },
      { what: 'Save', name: /save|update/i, mustBeEnabled: true },
    ],
  },
  // ---- Campaigns CRUD ----
  {
    area: 'Campaigns',
    route: '/campaigns',
    controls: [
      { what: 'Campaign name input', role: 'textbox', name: /name|campaign/i, soft: true },
      { what: 'Save/create campaign', name: /save|create|add/i, mustBeEnabled: true },
    ],
  },
  // ---- Composer entry ----
  {
    area: 'Calendar → Create Post',
    route: '/launches',
    controls: [
      { what: 'Create Post button', name: /create post|create a post/i, mustBeEnabled: true },
    ],
  },
  // ---- Comments inbox ----
  {
    area: 'Comments inbox',
    route: '/comments',
    controls: [
      { what: 'Filter control', name: /unread|status|filter|assigned/i, soft: true },
    ],
  },
  // ---- Media ----
  {
    area: 'Media library',
    route: '/media',
    controls: [
      { what: 'Upload control', name: /upload|add|browse/i, mustBeEnabled: true, soft: true },
    ],
  },
  // ---- Analytics tabs exist ----
  {
    area: 'Analytics tabs',
    route: '/analytics/v2',
    controls: [
      { what: 'Overview tab', name: /overview/i },
      { what: 'Channels tab', name: /channels/i, soft: true },
      { what: 'Posts tab', name: /posts/i, soft: true },
      { what: 'Best time tab', name: /best time/i, soft: true },
      { what: 'Recommendations tab', name: /recommendations/i, soft: true },
      { what: 'Watchlist tab', name: /watchlist/i, soft: true },
    ],
  },
];
