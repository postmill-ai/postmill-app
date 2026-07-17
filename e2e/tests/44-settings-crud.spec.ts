import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { inventory, safeClickByLabel, dismissModal } from './lib/crawl';

/**
 * Settings CRUD / completeness audit.
 *
 * The /settings route renders <SettingsPopup/> directly. Its tabs are plain clickable
 * <div>s with visible text (NOT ARIA role=tab), so we open each by page.getByText(label).
 * We catalog every settings tab, flag near-empty / action-less tabs, then DEEP-DIVE Teams.
 *
 * HEADLINE: the user reports Teams is incomplete — "can't CRUD team members, can't invite,
 * can't view a member's profile." This spec detects exactly that class of incompleteness:
 * for Teams we assert the controls a working team manager needs (invite, email input, role
 * selector, member rows, per-member actions, clickable profile) and record present/missing,
 * then attempt a real invite and capture the POST + status.
 *
 * Selectors are role/text/placeholder only — NEVER a regex inside a CSS locator string.
 * Everything is wrapped in try/catch + timeouts; the test always PASSES and records findings.
 */

// Candidate tab labels rendered by settings.component.tsx (visible text).
// Admin tabs only appear for super-admins; we probe them too and simply record absence.
const TAB_CANDIDATES = [
  'Global Settings',
  'Teams',
  'Webhooks',
  'Auto Post',
  'Sets',
  'Signatures',
  'Brand & AI',
  'Developers',
  'Approved Apps',
  // admin-only:
  'AI Providers',
  'Provider Capabilities',
  'Channel Config',
  'Error Log',
];

const NEAR_EMPTY_TEXT = 40;

interface PerTab {
  label: string;
  found: boolean;
  tabLoaded: boolean;
  textLen: number;
  visibleButtons: string[];
  inputs: number;
  apiErrors: string[];
  flags: string[];
}

interface TeamsGap {
  control: string;
  present: boolean;
  enabled: boolean;
  detail: string;
}

test('settings CRUD completeness + Teams deep-dive', async ({ page }) => {
  test.setTimeout(180_000);

  const auditor = new PageAuditor(page).attach();

  const results: {
    route: string;
    tabsFound: string[];
    tabsMissing: string[];
    perTab: PerTab[];
    teams: {
      reached: boolean;
      gaps: TeamsGap[];
      memberRows: number;
      perMemberActions: number;
      profileClickable: boolean;
      profileNote: string;
      inviteAttempted: boolean;
      inviteRequest: string | null;
      inviteStatus: number | null;
      inviteConfirmed: boolean;
      inviteNote: string;
    };
    webhooks: { reached: boolean; addControl: boolean; enabled: boolean; note: string };
    developers: { reached: boolean; generateControl: boolean; enabled: boolean; note: string };
    apiErrors: string[];
    consoleErrors: string[];
    throttled: boolean;
    headlineGaps: string[];
  } = {
    route: '/settings',
    tabsFound: [],
    tabsMissing: [],
    perTab: [],
    teams: {
      reached: false,
      gaps: [],
      memberRows: 0,
      perMemberActions: 0,
      profileClickable: false,
      profileNote: '',
      inviteAttempted: false,
      inviteRequest: null,
      inviteStatus: null,
      inviteConfirmed: false,
      inviteNote: '',
    },
    webhooks: { reached: false, addControl: false, enabled: false, note: '' },
    developers: { reached: false, generateControl: false, enabled: false, note: '' },
    apiErrors: [],
    consoleErrors: [],
    throttled: false,
    headlineGaps: [],
  };

  // ---- helpers ---------------------------------------------------------------

  const mainTextLen = async (): Promise<number> => {
    try {
      const t = await page.locator('main, [role="main"], body').first().innerText();
      return t.replace(/\s+/g, ' ').trim().length;
    } catch {
      return 0;
    }
  };

  // Open a tab by its visible text (tabs are clickable divs). Returns whether it was found.
  const openTab = async (label: string): Promise<boolean> => {
    try {
      const el = page.getByText(label, { exact: true }).first();
      if (!(await el.isVisible({ timeout: 2500 }).catch(() => false))) return false;
      await el.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1200);
      return true;
    } catch {
      return false;
    }
  };

  // ---- 1. goto /settings, catalog tabs --------------------------------------

  try {
    await page.goto('/settings', { timeout: 25000 });
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (e: any) {
    results.headlineGaps.push('FATAL: could not load /settings: ' + String(e?.message).slice(0, 80));
  }

  for (const label of TAB_CANDIDATES) {
    let visible = false;
    try {
      visible = await page
        .getByText(label, { exact: true })
        .first()
        .isVisible({ timeout: 1500 })
        .catch(() => false);
    } catch {
      visible = false;
    }
    if (visible) results.tabsFound.push(label);
    else results.tabsMissing.push(label);
  }

  // ---- 2. per-tab catalog ----------------------------------------------------

  for (const label of results.tabsFound) {
    const entry: PerTab = {
      label,
      found: true,
      tabLoaded: false,
      textLen: 0,
      visibleButtons: [],
      inputs: 0,
      apiErrors: [],
      flags: [],
    };
    auditor.reset();
    try {
      const opened = await openTab(label);
      entry.tabLoaded = opened;
      if (opened) {
        await page.waitForTimeout(800);
        entry.textLen = await mainTextLen();
        const inv = await inventory(page).catch(() => []);
        entry.visibleButtons = inv
          .filter((i) => i.visible && i.role === 'button' && i.label)
          .map((i) => i.label)
          .slice(0, 25);
        entry.inputs = inv.filter((i) => i.visible && (i.role === 'textbox' || i.role === 'combobox')).length;

        if (entry.textLen < NEAR_EMPTY_TEXT) entry.flags.push('NEAR_EMPTY_RENDER');
        if (entry.visibleButtons.length === 0) entry.flags.push('ZERO_ACTIONABLE_BUTTONS');
      } else {
        entry.flags.push('TAB_DID_NOT_OPEN');
      }
    } catch (e: any) {
      entry.flags.push('ERROR: ' + String(e?.message).slice(0, 60));
    }
    const snap = auditor.snapshot();
    entry.apiErrors = snap.apiErrors.map((c) => `${c.status} ${c.method} ${c.url}`);
    results.perTab.push(entry);
  }

  // ---- 3. TEAMS DEEP-DIVE (headline) ----------------------------------------

  if (results.tabsFound.includes('Teams')) {
    auditor.reset();
    const t = results.teams;
    try {
      t.reached = await openTab('Teams');
      await page.waitForTimeout(1200);
    } catch (e: any) {
      t.reached = false;
    }

    if (!t.reached) {
      results.headlineGaps.push('TEAMS: tab present but failed to open');
    } else {
      // (a) invite control — real label is "Add another member". Accept a broad set.
      const inviteControl = page
        .getByRole('button', { name: /invite|add member|add team|add another member/i })
        .first();
      let invitePresent = false;
      let inviteEnabled = false;
      try {
        invitePresent = await inviteControl.isVisible({ timeout: 2500 }).catch(() => false);
        if (invitePresent) inviteEnabled = await inviteControl.isEnabled().catch(() => true);
      } catch {
        invitePresent = false;
      }
      t.gaps.push({
        control: 'invite/add-member button',
        present: invitePresent,
        enabled: inviteEnabled,
        detail: invitePresent ? 'found' : 'MISSING — user-reported bug (cannot invite)',
      });
      if (!invitePresent) results.headlineGaps.push('TEAMS GAP: no invite/add-member control (cannot invite)');
      else if (!inviteEnabled) results.headlineGaps.push('TEAMS GAP: invite control present but DISABLED');

      // (b) member rows — the component renders capitalized email-prefix + role text,
      // NOT the full "@" address. So count role/owner/member text as well as "@".
      let memberRows = 0;
      try {
        memberRows = await page
          .getByText(/@|\bowner\b|\badmin\b|\bmember\b|\buser\b|super admin/i)
          .count()
          .catch(() => 0);
      } catch {
        memberRows = 0;
      }
      t.memberRows = memberRows;
      t.gaps.push({
        control: 'member list rows',
        present: memberRows > 0,
        enabled: true,
        detail: `${memberRows} member/role text nodes`,
      });

      // (c) per-member actions: remove / delete / edit / view / profile buttons
      let perMemberActions = 0;
      try {
        perMemberActions = await page
          .getByRole('button', { name: /remove|delete|edit|view|profile/i })
          .count()
          .catch(() => 0);
      } catch {
        perMemberActions = 0;
      }
      t.perMemberActions = perMemberActions;
      t.gaps.push({
        control: 'per-member actions (remove/edit/view/profile)',
        present: perMemberActions > 0,
        enabled: true,
        detail: `${perMemberActions} action button(s) found`,
      });
      // The component only renders a Remove button (no edit/view/profile). Detect that gap.
      let editViewCount = 0;
      try {
        editViewCount = await page
          .getByRole('button', { name: /edit|view|profile/i })
          .count()
          .catch(() => 0);
      } catch {
        editViewCount = 0;
      }
      t.gaps.push({
        control: 'edit / view-profile actions',
        present: editViewCount > 0,
        enabled: editViewCount > 0,
        detail: editViewCount > 0 ? `${editViewCount} edit/view button(s)` : 'MISSING — no edit/view-profile action (user-reported)',
      });
      if (editViewCount === 0) results.headlineGaps.push('TEAMS GAP: no edit / view-profile action on members');

      // (d) clickable profile: try clicking the first member name/row, record any reaction.
      try {
        const beforeUrl = page.url();
        // The name cell is plain text; click the first member-ish text node.
        const memberName = page
          .getByText(/@|\badmin\b|\buser\b|\bmember\b|super admin/i)
          .first();
        if (await memberName.isVisible({ timeout: 1500 }).catch(() => false)) {
          await memberName.click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(900);
          const afterUrl = page.url();
          const dialogVisible = await page
            .getByRole('dialog')
            .first()
            .isVisible({ timeout: 800 })
            .catch(() => false);
          if (afterUrl !== beforeUrl) {
            t.profileClickable = true;
            t.profileNote = 'navigated to ' + afterUrl;
          } else if (dialogVisible) {
            t.profileClickable = true;
            t.profileNote = 'opened a dialog/modal';
            await dismissModal(page).catch(() => {});
          } else {
            t.profileClickable = false;
            t.profileNote = 'DEAD — clicking member produced no navigation or modal';
          }
        } else {
          t.profileNote = 'no member row to click';
        }
      } catch (e: any) {
        t.profileNote = 'click-error: ' + String(e?.message).slice(0, 60);
      }
      t.gaps.push({
        control: 'clickable member profile',
        present: t.profileClickable,
        enabled: t.profileClickable,
        detail: t.profileNote,
      });
      if (!t.profileClickable) results.headlineGaps.push('TEAMS GAP: member rows are not clickable (no profile view)');

      // (e) ATTEMPT an invite if the control exists.
      if (invitePresent && inviteEnabled) {
        t.inviteAttempted = true;
        let inviteReq: { method: string; url: string } | null = null;
        const onReq = (req: any) => {
          const u: string = req.url();
          const m: string = req.method();
          if (m !== 'GET' && /\/api\/(settings\/team|user|teams)/i.test(u)) {
            inviteReq = { method: m, url: u.split('?')[0].replace('https://postiz.reaatech.com', '') };
          }
        };
        let inviteResStatus: number | null = null;
        const onRes = (res: any) => {
          const u: string = res.url();
          if (/\/api\/(settings\/team|teams)/i.test(u) && res.request().method() !== 'GET') {
            inviteResStatus = res.status();
          }
        };
        page.on('request', onReq);
        page.on('response', onRes);
        try {
          // Open the Add Member modal.
          await inviteControl.click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(900);

          // Email input — modal uses label "Email" / placeholder "Enter email".
          const emailBox = page
            .getByRole('textbox', { name: /email/i })
            .first();
          const emailByPlaceholder = page.getByPlaceholder(/email/i).first();
          const dummy = `e2e-invite-${Date.now()}@example.com`;
          let filled = false;
          if (await emailBox.isVisible({ timeout: 1500 }).catch(() => false)) {
            await emailBox.fill(dummy).catch(() => {});
            filled = true;
          } else if (await emailByPlaceholder.isVisible({ timeout: 1500 }).catch(() => false)) {
            await emailByPlaceholder.fill(dummy).catch(() => {});
            filled = true;
          }
          t.gaps.push({
            control: 'invite email input',
            present: filled,
            enabled: filled,
            detail: filled ? 'filled ' + dummy : 'MISSING — no email field in invite modal',
          });

          // Role selector — a native <select> exposes role=combobox.
          const roleSelect = page.getByRole('combobox').first();
          let rolePresent = false;
          if (await roleSelect.isVisible({ timeout: 1500 }).catch(() => false)) {
            rolePresent = true;
            await roleSelect.selectOption({ index: 1 }).catch(async () => {
              await roleSelect.selectOption({ label: 'Admin' }).catch(() => {});
            });
          }
          t.gaps.push({
            control: 'role selector (combobox)',
            present: rolePresent,
            enabled: rolePresent,
            detail: rolePresent ? 'selected a role' : 'MISSING — no role selector',
          });

          // Submit — button label is "Send Invitation Link" (or "Copy Link").
          const submitBtn = page
            .getByRole('button', { name: /send invitation|invite|copy link|add/i })
            .last();
          if (await submitBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
            await submitBtn.click({ timeout: 5000 }).catch(() => {});
            await page.waitForTimeout(2500);
          } else {
            t.inviteNote = 'no submit button in invite modal';
          }

          // Confirmation: a toast or the modal closing is a positive signal.
          const toastVisible = await page
            .getByText(/invitation link sent|link copied|invited|added/i)
            .first()
            .isVisible({ timeout: 1500 })
            .catch(() => false);
          t.inviteConfirmed = toastVisible;
        } catch (e: any) {
          t.inviteNote = 'invite-error: ' + String(e?.message).slice(0, 70);
        } finally {
          page.off('request', onReq);
          page.off('response', onRes);
          await dismissModal(page).catch(() => {});
        }
        t.inviteRequest = inviteReq ? `${inviteReq!.method} ${inviteReq!.url}` : null;
        t.inviteStatus = inviteResStatus;
        if (!t.inviteRequest) {
          results.headlineGaps.push('TEAMS GAP: invite submitted but NO network request fired (dead control)');
        } else if (inviteResStatus !== null && (inviteResStatus >= 400 || inviteResStatus === 0)) {
          results.headlineGaps.push(`TEAMS GAP: invite POST failed (${inviteResStatus}) ${t.inviteRequest}`);
        }
        if (!t.inviteConfirmed && t.inviteRequest && inviteResStatus !== null && inviteResStatus < 400) {
          t.inviteNote = t.inviteNote || 'request succeeded but no visible UI confirmation';
        }
      } else {
        t.inviteNote = 'invite not attempted (control missing/disabled)';
      }
    }
    // Capture any API errors that fired during the Teams dive.
    const teamsSnap = auditor.snapshot();
    for (const c of teamsSnap.apiErrors) {
      results.apiErrors.push(`[teams] ${c.status} ${c.method} ${c.url}`);
    }
  } else {
    results.headlineGaps.push('TEAMS: tab not present for this user (tier may lack team_members)');
  }

  // ---- 4. WEBHOOKS -----------------------------------------------------------

  if (results.tabsFound.includes('Webhooks')) {
    auditor.reset();
    try {
      results.webhooks.reached = await openTab('Webhooks');
      await page.waitForTimeout(900);
      const add = page.getByRole('button', { name: /add|create|new webhook|new/i }).first();
      const present = await add.isVisible({ timeout: 2000 }).catch(() => false);
      results.webhooks.addControl = present;
      results.webhooks.enabled = present ? await add.isEnabled().catch(() => true) : false;
      results.webhooks.note = present ? 'add-webhook control found' : 'no add-webhook control';
      if (!present) results.headlineGaps.push('WEBHOOKS GAP: no add-webhook control');
    } catch (e: any) {
      results.webhooks.note = 'error: ' + String(e?.message).slice(0, 60);
    }
  }

  // ---- 5. DEVELOPERS / API ---------------------------------------------------

  if (results.tabsFound.includes('Developers')) {
    auditor.reset();
    try {
      results.developers.reached = await openTab('Developers');
      await page.waitForTimeout(900);
      // The real API-key affordance is "Rotate Key" (shown when the user already has a
      // publicApi key); accept Generate/Create variants too. Only flag a gap if NONE exist.
      const gen = page
        .getByRole('button', { name: /rotate key|rotate|generate|create key|api key|new key|regenerate/i })
        .first();
      const present = await gen.isVisible({ timeout: 2000 }).catch(() => false);
      results.developers.generateControl = present;
      results.developers.enabled = present ? await gen.isEnabled().catch(() => true) : false;
      results.developers.note = present ? 'API-key control found (rotate/generate)' : 'no API-key control';
      if (!present) results.headlineGaps.push('DEVELOPERS GAP: no API-key control (rotate/generate)');
    } catch (e: any) {
      results.developers.note = 'error: ' + String(e?.message).slice(0, 60);
    }
  }

  // ---- 6. summarize ----------------------------------------------------------

  const finalSnap = auditor.snapshot();
  results.throttled = auditor.hadThrottle();
  results.consoleErrors = finalSnap.consoleErrors.slice(0, 30);
  // Merge any per-tab api errors into the global list (dedupe).
  for (const tab of results.perTab) {
    for (const e of tab.apiErrors) results.apiErrors.push(`[${tab.label}] ${e}`);
  }
  results.apiErrors = [...new Set(results.apiErrors)];

  auditor.detach();

  const outPath = path.join(__dirname, '..', 'results-settings-crud.json');
  try {
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  } catch (e: any) {
    console.log('Could not write results file:', String(e?.message).slice(0, 80));
  }

  // ---- console summary -------------------------------------------------------

  console.log('\n========== SETTINGS CRUD AUDIT ==========');
  console.log(`tabsFound (${results.tabsFound.length}): ${results.tabsFound.join(', ') || 'NONE'}`);
  console.log(`tabsMissing: ${results.tabsMissing.join(', ') || 'none'}`);
  if (results.throttled) console.log('!! 429 THROTTLE DETECTED — findings may be unreliable');

  console.log('\n--- per-tab ---');
  for (const t of results.perTab) {
    const flag = t.flags.length ? '  [' + t.flags.join(', ') + ']' : '';
    console.log(
      `  ${t.label.padEnd(22)} loaded=${t.tabLoaded ? 'Y' : 'N'} text=${t.textLen} buttons=${t.visibleButtons.length} inputs=${t.inputs}${flag}`
    );
    if (t.apiErrors.length) console.log(`      apiErrors: ${t.apiErrors.join(' | ')}`);
  }

  console.log('\n***** TEAMS DEEP-DIVE (headline) *****');
  const tm = results.teams;
  if (!results.tabsFound.includes('Teams')) {
    console.log('  Teams tab NOT present for this user.');
  } else {
    console.log(`  reached=${tm.reached} memberRows=${tm.memberRows} perMemberActions=${tm.perMemberActions}`);
    console.log(`  profileClickable=${tm.profileClickable} (${tm.profileNote})`);
    for (const g of tm.gaps) {
      const mark = g.present ? (g.enabled ? 'OK ' : 'DISABLED') : 'MISSING';
      console.log(`  [${mark.padEnd(8)}] ${g.control.padEnd(42)} ${g.detail}`);
    }
    console.log(
      `  invite: attempted=${tm.inviteAttempted} request=${tm.inviteRequest || 'NONE'} status=${tm.inviteStatus ?? 'n/a'} confirmed=${tm.inviteConfirmed}`
    );
    if (tm.inviteNote) console.log(`  invite note: ${tm.inviteNote}`);
  }

  console.log('\n--- webhooks ---');
  console.log(`  reached=${results.webhooks.reached} addControl=${results.webhooks.addControl} enabled=${results.webhooks.enabled} (${results.webhooks.note})`);
  console.log('--- developers ---');
  console.log(`  reached=${results.developers.reached} generateControl=${results.developers.generateControl} enabled=${results.developers.enabled} (${results.developers.note})`);

  console.log('\n***** HEADLINE GAPS *****');
  if (results.headlineGaps.length === 0) console.log('  (none detected)');
  for (const g of results.headlineGaps) console.log('  - ' + g);

  console.log(`\napiErrors (${results.apiErrors.length}): ${results.apiErrors.slice(0, 6).join(' | ') || 'none'}`);
  console.log(`consoleErrors (${results.consoleErrors.length}): ${results.consoleErrors.slice(0, 4).join(' | ') || 'none'}`);
  console.log(`\nresults -> ${outPath}`);
  console.log('=========================================\n');

  // The test records findings and must PASS regardless of gaps found.
});
