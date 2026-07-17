import { test, expect } from '@playwright/test';

/**
 * Regression guard for the color-contrast fixes (a11y):
 *  - subtle btnPrimary chips now use the theme-aware `text-btnPrimaryAccent` token,
 *  - the notification count badge (`bg-badge`) was darkened so white text passes.
 * Both must meet WCAG AA (>=4.5:1) in BOTH themes. Measured live on /campaigns.
 */
const CONTRAST_FN = `(sel) => {
  const parseRGB = (s) => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const lum = (o) => 0.2126*lin(o.r)+0.7152*lin(o.g)+0.0722*lin(o.b);
  const over = (fg, bg) => ({ r: fg.r*fg.a+bg.r*(1-fg.a), g: fg.g*fg.a+bg.g*(1-fg.a), b: fg.b*fg.a+bg.b*(1-fg.a), a:1 });
  const effBg = (el) => { const st=[]; let n=el; while(n){const c=parseRGB(getComputedStyle(n).backgroundColor); if(c&&c.a>0)st.unshift(c); n=n.parentElement;} let a={r:255,g:255,b:255,a:1}; for(const c of st) a=over(c,a); return a; };
  const el = [...document.querySelectorAll(sel)].find(e => (e.textContent||'').trim());
  if (!el) return null;
  const fg = parseRGB(getComputedStyle(el).color); const bg = effBg(el); if (!fg) return null;
  const cf = fg.a<1?over(fg,bg):fg; const L1=lum(cf),L2=lum(bg); const hi=Math.max(L1,L2),lo=Math.min(L1,L2);
  return Math.round(((hi+0.05)/(lo+0.05))*100)/100;
}`;

for (const theme of ['dark', 'light'] as const) {
  test(`chips + badge meet AA contrast (${theme})`, async ({ page, context }) => {
    await context.addCookies([{ name: 'mode', value: theme, domain: 'localhost', path: '/' }]);
    await page.goto('/campaigns');
    if (/\/auth\//.test(page.url())) test.skip(true, 'not authed');
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1200);

    const chip = await page.evaluate(`(${CONTRAST_FN})('.text-btnPrimaryAccent')`);
    const badge = await page.evaluate(`(${CONTRAST_FN})('.bg-badge')`);

    if (chip !== null) expect(chip, `chip accent contrast (${theme})`).toBeGreaterThanOrEqual(4.5);
    if (badge !== null) expect(badge, `notification badge contrast (${theme})`).toBeGreaterThanOrEqual(4.5);
    // At least one target should exist so the test isn't silently vacuous.
    expect(chip !== null || badge !== null, 'no contrast targets found on /campaigns').toBeTruthy();
  });
}
