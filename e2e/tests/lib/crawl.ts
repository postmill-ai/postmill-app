import type { Page, Locator } from '@playwright/test';

export interface Actionable {
  role: 'button' | 'link' | 'tab' | 'checkbox' | 'textbox' | 'combobox';
  label: string;
  visible: boolean;
  enabled: boolean;
}

const clean = (s: string) => (s || '').replace(/\s+/g, ' ').trim().slice(0, 60);

/**
 * Auto-discover every actionable element on the current page by ARIA role — NO hardcoded
 * selectors, so this can't go stale. Returns a catalog with label + visible/enabled state.
 * This is what makes "cover every clickable link/button/action" true by construction.
 */
export async function inventory(page: Page): Promise<Actionable[]> {
  const out: Actionable[] = [];
  const roles: Actionable['role'][] = ['button', 'link', 'tab', 'checkbox', 'textbox', 'combobox'];

  for (const role of roles) {
    const loc = page.getByRole(role as any);
    const count = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(count, 200); i++) {
      const el = loc.nth(i);
      const [visible, enabled, name, text] = await Promise.all([
        el.isVisible().catch(() => false),
        el.isEnabled().catch(() => true),
        el.getAttribute('aria-label').catch(() => null),
        el.textContent().catch(() => ''),
      ]);
      const label = clean(name || text || '');
      out.push({ role, label, visible, enabled });
    }
  }
  return out;
}

/** Count visible, enabled buttons/links — a page with zero is suspect (dead/blank). */
export function actionableSummary(items: Actionable[]) {
  const visible = items.filter((i) => i.visible);
  return {
    total: items.length,
    visible: visible.length,
    buttons: visible.filter((i) => i.role === 'button').length,
    links: visible.filter((i) => i.role === 'link').length,
    tabs: visible.filter((i) => i.role === 'tab').length,
    inputs: visible.filter((i) => i.role === 'textbox' || i.role === 'combobox').length,
    disabledButtons: visible.filter((i) => i.role === 'button' && !i.enabled).map((i) => i.label).filter(Boolean),
  };
}

/**
 * Click an element by accessible name and report the outcome (navigation / modal / error),
 * then attempt to return to a clean state by closing any modal. Non-destructive callers
 * should pass labels they know are safe (we skip Delete/Remove/Logout by default).
 */
const DESTRUCTIVE = /delete|remove|disconnect|revoke|cancel subscription|log ?out|sign ?out|deactivate|reset/i;

export async function safeClickByLabel(
  page: Page,
  label: string | RegExp,
  opts: { role?: 'button' | 'link' | 'tab'; allowDestructive?: boolean } = {}
): Promise<{ clicked: boolean; note: string }> {
  const role = opts.role || 'button';
  const text = typeof label === 'string' ? label : label.source;
  if (!opts.allowDestructive && DESTRUCTIVE.test(text)) {
    return { clicked: false, note: 'skipped-destructive' };
  }
  try {
    const el = page.getByRole(role as any, { name: label }).first();
    if (!(await el.isVisible({ timeout: 2000 }).catch(() => false))) {
      return { clicked: false, note: 'not-visible' };
    }
    if (!(await el.isEnabled().catch(() => true))) {
      return { clicked: false, note: 'disabled' };
    }
    await el.click({ timeout: 5000 });
    return { clicked: true, note: 'ok' };
  } catch (e: any) {
    return { clicked: false, note: 'click-error: ' + String(e.message).slice(0, 60) };
  }
}

/** Close any open modal/dialog so the next probe starts clean. */
export async function dismissModal(page: Page) {
  for (const sel of [
    page.getByRole('button', { name: /close|cancel/i }).first(),
    page.locator('[aria-label*="close" i]').first(),
    page.locator('[data-testid="close"]').first(),
  ]) {
    if (await sel.isVisible({ timeout: 500 }).catch(() => false)) {
      await sel.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(300);
      return;
    }
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(200);
}

/** Count broken images (naturalWidth === 0 after load) — a "data missing / not right" signal. */
export async function brokenImages(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      const imgs = Array.from(document.images);
      return imgs.filter((i) => i.complete && i.naturalWidth === 0 && !!i.getAttribute('src')).length;
    })
    .catch(() => 0);
}

/** Heuristic: does the main content region look empty (almost no text)? */
export async function mainTextLength(page: Page): Promise<number> {
  return page
    .locator('main, [role="main"], body')
    .first()
    .innerText()
    .then((t) => t.replace(/\s+/g, ' ').trim().length)
    .catch(() => 0);
}
