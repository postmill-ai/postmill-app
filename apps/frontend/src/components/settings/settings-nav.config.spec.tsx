import { describe, it, expect } from 'vitest';
import {
  SETTINGS_NAV,
  SETTINGS_SECTION_ORDER,
  visibleSettingsNav,
  type SettingsGateCtx,
} from '@postmill-ai/frontend/components/settings/settings-nav.config';
import {
  LEGACY_TAB_TO_PATH,
  SETTINGS_DEFAULT_PATH,
} from '@postmill-ai/frontend/components/settings/settings-paths';
import en from '@postmill-ai/react/translation/locales/en/translation.json';

// Guards the settings nav config: the legacy ?tab= compat map must cover every old tab key,
// hrefs must be unique routes, and the tier/permission gates must mirror the old SettingsPopup
// render-guards (so a deep-linked unentitled user is gated, not exposed).

const item = (key: string) => {
  const found = SETTINGS_NAV.find((i) => i.key === key);
  if (!found) throw new Error(`nav item '${key}' not found`);
  return found;
};

const ctx = (over: Partial<SettingsGateCtx>): SettingsGateCtx => ({
  user: undefined,
  permissions: { hasPermission: () => false },
  isGeneral: true,
  billingEnabled: true,
  showLogout: true,
  ...over,
});

describe('settings nav config', () => {
  it('every href is unique and either under /settings/ or the campaigns shortcut', () => {
    const hrefs = SETTINGS_NAV.map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) {
      expect(h.startsWith('/settings/') || h === '/campaigns').toBe(true);
    }
  });

  it('has no standalone roles item (folded into Team)', () => {
    expect(SETTINGS_NAV.some((i) => i.key === 'roles')).toBe(false);
    expect(SETTINGS_NAV.some((i) => i.key === 'team')).toBe(true);
  });

  it('has no item pointing at the /settings index itself', () => {
    // The layout resolves its <h2> with `pathname.startsWith(item.href)`, and
    // sectionless items sort first (indexOf('') === -1). An item with
    // href '/settings' would therefore win the active lookup on nearly every
    // settings route and render the wrong heading throughout. The index is a
    // page, not a nav entry.
    expect(SETTINGS_NAV.every((i) => i.href !== '/settings')).toBe(true);
  });

  // `t(key, fallback)` only uses the fallback when the key is ABSENT, so a nav
  // item whose keys aren't in the locale files renders English in every language.
  // Every item's copy shipped untranslated for exactly this reason; these two
  // cases stop it happening again.
  it('every label and description key exists in the locale files', () => {
    const catalog = en as Record<string, string>;
    for (const nav of SETTINGS_NAV) {
      expect(catalog[nav.labelKey], `missing translation key '${nav.labelKey}'`).toBeDefined();
      expect(catalog[nav.descKey], `missing translation key '${nav.descKey}'`).toBeDefined();
    }
  });

  it('the English catalog matches the inline defaults, so nothing silently changes wording', () => {
    const catalog = en as Record<string, string>;
    for (const nav of SETTINGS_NAV) {
      expect(catalog[nav.labelKey]).toBe(nav.labelDefault);
      expect(catalog[nav.descKey]).toBe(nav.descDefault);
    }
  });

  it('legacy ?tab= map covers every old top-level tab + content alias', () => {
    const oldKeys = [
      'teams', 'roles', 'broadcast', 'channels', 'ai', 'shortlinks', 'content',
      'vpn', 'storage', 'webhooks', 'autopost', 'api', 'approved_apps',
      'media_providers', 'content_packs', 'sets', 'signatures',
    ];
    for (const k of oldKeys) {
      expect(LEGACY_TAB_TO_PATH[k], `missing legacy mapping for '${k}'`).toBeDefined();
      expect(LEGACY_TAB_TO_PATH[k].startsWith('/settings/')).toBe(true);
    }
    // roles + teams both fold into the Team page.
    expect(LEGACY_TAB_TO_PATH.roles).toBe('/settings/team');
    expect(LEGACY_TAB_TO_PATH.teams).toBe('/settings/team');
    expect(SETTINGS_DEFAULT_PATH).toBe('/settings/channels');
  });

  it('ungated items are always visible', () => {
    for (const key of ['channels', 'ai', 'shortlinks', 'content', 'vpn', 'storage', 'approved-apps']) {
      expect(item(key).gate).toBeUndefined();
    }
  });

  it('team gate requires a multi-seat plan (team_members > 1) and isGeneral', () => {
    const gate = item('team').gate!;
    // Multi-seat plan (e.g. Pro=3) shows Team management.
    expect(gate(ctx({ user: { tier: { team_members: 3 } }, isGeneral: true }))).toBe(true);
    expect(gate(ctx({ user: { tier: { team_members: 3 } }, isGeneral: false }))).toBe(false);
    // Starter (1 seat = owner only) must NOT show Team management.
    expect(gate(ctx({ user: { tier: { team_members: 1 } }, isGeneral: true }))).toBe(false);
    expect(gate(ctx({ user: { tier: {} } }))).toBe(false);
    expect(gate(ctx({ user: undefined }))).toBe(false);
  });

  it('webhooks gate requires its tier flag and autopost is always visible', () => {
    expect(item('webhooks').gate!(ctx({ user: { tier: { webhooks: true } } }))).toBe(true);
    expect(item('webhooks').gate!(ctx({ user: { tier: {} } }))).toBe(false);
    // Auto Post was moved out of the tier gate during the subscription revamp
    // and is now available to every org.
    expect(item('autopost').gate!(ctx({ user: { tier: { autoPost: true } } }))).toBe(true);
    expect(item('autopost').gate!(ctx({ user: { tier: {} } }))).toBe(true);
  });

  it('broadcast gate requires notifications:manage', () => {
    const gate = item('broadcast').gate!;
    expect(gate(ctx({ permissions: { hasPermission: (r, a) => r === 'notifications' && a === 'manage' } }))).toBe(true);
    expect(gate(ctx({ permissions: { hasPermission: () => false } }))).toBe(false);
  });

  it('developers gate requires api + isGeneral + showLogout', () => {
    const gate = item('developers').gate!;
    expect(gate(ctx({ user: { tier: { api: true } }, isGeneral: true, showLogout: true }))).toBe(true);
    expect(gate(ctx({ user: { tier: { api: true } }, isGeneral: true, showLogout: false }))).toBe(false);
    expect(gate(ctx({ user: { tier: { api: true } }, isGeneral: false, showLogout: true }))).toBe(false);
    expect(gate(ctx({ user: { tier: {} }, isGeneral: true, showLogout: true }))).toBe(false);
  });
});

describe('visibleSettingsNav', () => {
  // Shared by the settings rail and the /settings index so the two can never
  // show a different set, or a different order, to the same user.
  const t = (_k: string, d: string) => d;
  const openCtx = () =>
    ctx({
      user: { tier: { team_members: 5, brand_kits: 2, campaigns: true, api: true, webhooks: true } },
      permissions: { hasPermission: () => true },
    });

  it('drops gated items the context denies', () => {
    const denied = visibleSettingsNav(ctx({ user: { tier: {} } }), t).map((i) => i.key);
    expect(denied).not.toContain('webhooks');
    expect(denied).not.toContain('developers');
    expect(denied).toContain('channels');
  });

  it('keeps gated items the context allows', () => {
    const allowed = visibleSettingsNav(openCtx(), t).map((i) => i.key);
    expect(allowed).toContain('webhooks');
    expect(allowed).toContain('team');
    expect(allowed).toContain('brands');
  });

  it('sorts sectionless items before every labelled group', () => {
    // indexOf('') is -1, which is what puts them first — the index renders this
    // leading group unlabelled, exactly like the rail.
    const items = visibleSettingsNav(openCtx(), t);
    const firstSectioned = items.findIndex((i) => !!i.section);
    expect(firstSectioned).toBeGreaterThan(0);
    expect(items.slice(0, firstSectioned).every((i) => !i.section)).toBe(true);
  });

  it('groups in SETTINGS_SECTION_ORDER and sorts by translated label within a group', () => {
    const items = visibleSettingsNav(openCtx(), t);
    const rank = items.map((i) => SETTINGS_SECTION_ORDER.indexOf(i.section || ''));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));

    for (const section of SETTINGS_SECTION_ORDER) {
      const labels = items
        .filter((i) => i.section === section)
        .map((i) => i.labelDefault);
      expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('never returns the same href twice', () => {
    const hrefs = visibleSettingsNav(openCtx(), t).map((i) => i.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
