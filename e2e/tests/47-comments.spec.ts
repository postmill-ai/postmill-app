import { test } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { PageAuditor } from './lib/audit';
import { inventory } from './lib/crawl';

/**
 * 47 — Unified comment inbox audit (author-only; do NOT run as part of authoring).
 *
 * Single test, robust + non-fatal: every probe is wrapped in try/catch and the test
 * always PASSES while recording findings. We load /comments, distinguish a proper
 * empty-state from a blank/broken page, enumerate the filter controls, toggle
 * "Unread only" and confirm the inbox refetches with unreadOnly=true, and — only if
 * comments exist — verify the mark-read and reply controls. We never post a real reply
 * (could hit a live platform); we only confirm the reply control exists + opens an input.
 *
 * UI facts sourced from comments/comment.inbox.tsx + comment.inbox.filters.tsx:
 *  - Route /comments (unified comment inbox).
 *  - Filters row: status buttons ("All", "Needs Reply", "Handled", "Ignored") and an
 *    "Unread only" checkbox. (Spec also probes for a combobox/assignee selector in case
 *    the UI evolves — absence is recorded, not failed.)
 *  - Each comment row: author name + body text + per-row "Mark handled" button
 *    (hidden once status === 'handled'). Body click navigates to the post.
 *  - "Load more" button when nextCursor is present.
 *  - API: GET /api/posts/inbox?status=&unreadOnly=&assigneeId=&cursor= → {comments,nextCursor?};
 *    mark-read POSTs /api/posts/inbox/bulk-read.
 */

// The inbox empty-state renders "No comments found matching your filters". Match that
// (and equivalents) so zero comments WITH the message counts as a proper empty-state, not a gap.
const EMPTY_RE = /no comments found|no comments|matching your filters|all caught up|empty/i;
const INBOX_GET = (c: { method: string; url: string }) =>
  c.method === 'GET' && c.url.includes('/posts/inbox');

test('comment inbox audit', async ({ page }) => {
  const auditor = new PageAuditor(page).attach();

  const findings: any = {
    route: '/comments',
    load: {},
    commentCount: 0,
    emptyStateShown: false,
    dataMissing: false,
    filtersPresent: [] as string[],
    unreadToggle: { found: false, refetched: false, withUnreadTrue: false, note: '' },
    markReadPresent: false,
    markReadEnabled: false,
    markReadPosted: null as null | { status: number },
    replyPresent: false,
    replyOpensInput: false,
    gaps: [] as string[],
    apiErrors: [],
    consoleErrors: [],
    throttled: false,
    flags: [] as string[],
  };

  const settle = async () => {
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1200);
  };

  // ===== 1. Load the inbox =====
  try {
    const resp = await page.goto('/comments', { timeout: 25000 });
    findings.load.status = resp?.status() ?? 0;
    await settle();
    findings.load.url = page.url();
    findings.load.redirectedToAuth = /\/auth(\/|$)/.test(page.url());
    try {
      findings.load.textLen = (
        await page.locator('main, [role="main"], body').first().innerText()
      )
        .replace(/\s+/g, ' ')
        .trim().length;
    } catch {
      findings.load.textLen = 0;
    }
    await page.screenshot({ path: 'comments-load.png' }).catch(() => {});
  } catch (e: any) {
    findings.load.error = String(e?.message || e).slice(0, 150);
    findings.flags.push('load-exception');
  }

  // Record the inbox GET call + status that fired on load.
  try {
    const snap = auditor.snapshot();
    const inboxCall = snap.apiCalls.find(INBOX_GET);
    findings.load.inboxApi = inboxCall
      ? { url: inboxCall.url, status: inboxCall.status, query: inboxCall.query }
      : null;
    if (inboxCall && inboxCall.status >= 400) {
      findings.gaps.push(`inbox API ${inboxCall.status}`);
      findings.flags.push(`inbox-api-${inboxCall.status}`);
    }
    if (!inboxCall) findings.flags.push('no-inbox-api-call');
  } catch {
    /* ignore */
  }

  // Bail early but still PASS + write results if we never reached the inbox.
  if (findings.load.redirectedToAuth || (findings.load.status ?? 0) >= 400) {
    findings.flags.push('inbox-not-accessible');
    finish(findings, auditor);
    return;
  }

  // ===== 2. EMPTY-STATE vs DATA =====
  // Comment rows render author name + body + a "Mark handled" action. We avoid fragile
  // CSS: count via the per-row "Mark handled" buttons and cross-check with empty-state text.
  try {
    let markHandledCount = 0;
    try {
      markHandledCount = await page
        .getByRole('button', { name: /mark handled|mark as read|mark read/i })
        .count();
    } catch {
      markHandledCount = 0;
    }

    let emptyShown = false;
    try {
      emptyShown = (await page.getByText(EMPTY_RE).count()) > 0;
    } catch {
      emptyShown = false;
    }

    // Best-effort secondary count: inventory of actionable elements (does not drive logic).
    let actionableButtons = 0;
    try {
      const items = await inventory(page);
      actionableButtons = items.filter((i) => i.visible && i.role === 'button').length;
    } catch {
      /* ignore */
    }
    findings.load.actionableButtons = actionableButtons;

    findings.commentCount = markHandledCount;
    findings.emptyStateShown = emptyShown;

    // Zero comments + a proper empty-state message = OK. Zero + blank page = data missing.
    if (markHandledCount === 0 && !emptyShown) {
      const textLen = findings.load.textLen ?? 0;
      // A real inbox always renders the filter row, so some chrome text is expected.
      if (textLen < 40) {
        findings.dataMissing = true;
        findings.gaps.push('data missing / not right (zero comments, blank page)');
        findings.flags.push('data-missing-blank');
      } else {
        // Chrome present but neither rows nor an explicit empty-state message.
        findings.flags.push('no-empty-state-message');
        findings.gaps.push('zero comments but no empty-state message');
      }
    }
  } catch (e: any) {
    findings.flags.push('count-exception: ' + String(e?.message || e).slice(0, 60));
  }

  // ===== 3. FILTERS — enumerate which controls are present =====
  try {
    // "Unread only" checkbox/label.
    let unreadFound = false;
    try {
      unreadFound =
        (await page.getByText(/unread/i).count()) > 0 ||
        (await page.getByRole('checkbox').count()) > 0;
    } catch {
      unreadFound = false;
    }
    if (unreadFound) findings.filtersPresent.push('unreadOnly');

    // Status filter — buttons in this build (All / Needs Reply / Handled / Ignored),
    // but probe combobox too in case the UI moves to a dropdown.
    let statusFound = false;
    try {
      const statusBtns = await page
        .getByRole('button', { name: /needs reply|handled|ignored|^all$/i })
        .count();
      const comboCount = await page.getByRole('combobox').count();
      statusFound = statusBtns > 0 || comboCount > 0;
      if (comboCount > 0) findings.filtersPresent.push('combobox');
    } catch {
      statusFound = false;
    }
    if (statusFound) findings.filtersPresent.push('status');

    // Assignee selector — not present in this build; record if it ever appears.
    try {
      if ((await page.getByText(/assign(ee|ed)?/i).count()) > 0) {
        findings.filtersPresent.push('assignee');
      }
    } catch {
      /* ignore */
    }

    if (findings.filtersPresent.length === 0) {
      findings.gaps.push('no filter controls found');
      findings.flags.push('filters-missing');
    }
  } catch (e: any) {
    findings.flags.push('filters-exception: ' + String(e?.message || e).slice(0, 60));
  }

  // ===== 4. Toggle "Unread only" and confirm a refetch with unreadOnly=true =====
  try {
    auditor.reset();
    let toggled = false;

    // Prefer the checkbox role; fall back to clicking the "Unread only" label text.
    try {
      const cb = page.getByRole('checkbox').first();
      if (await cb.isVisible({ timeout: 2000 }).catch(() => false)) {
        findings.unreadToggle.found = true;
        await cb.click({ timeout: 4000 });
        toggled = true;
      }
    } catch {
      /* fall through */
    }
    if (!toggled) {
      try {
        const lbl = page.getByText(/unread only/i).first();
        if (await lbl.isVisible({ timeout: 2000 }).catch(() => false)) {
          findings.unreadToggle.found = true;
          await lbl.click({ timeout: 4000 });
          toggled = true;
        }
      } catch {
        /* not found */
      }
    }

    if (!toggled) {
      findings.unreadToggle.note = 'unread-only toggle not found';
      findings.flags.push('unread-toggle: not-found');
    } else {
      await settle();
      const snap = auditor.snapshot();
      const refetches = snap.apiCalls.filter(INBOX_GET);
      findings.unreadToggle.refetched = refetches.length > 0;
      findings.unreadToggle.withUnreadTrue = refetches.some((c) =>
        /unreadOnly=true/i.test(c.query || '')
      );
      findings.unreadToggle.calls = refetches.map((c) => ({
        url: c.url,
        status: c.status,
        query: c.query,
      }));
      if (!findings.unreadToggle.refetched) {
        findings.flags.push('unread-toggle: no-refetch');
      } else if (!findings.unreadToggle.withUnreadTrue) {
        findings.flags.push('unread-toggle: refetch-missing-unreadOnly=true');
      }
    }
  } catch (e: any) {
    findings.unreadToggle.note = String(e?.message || e).slice(0, 120);
    findings.flags.push('unread-toggle: exception');
  }

  // ===== 5. ACTIONS — only if comments exist =====
  if (findings.commentCount > 0) {
    // ---- mark-read control ----
    try {
      const markBtn = page
        .getByRole('button', { name: /mark handled|mark as read|mark read|read/i })
        .first();
      if (await markBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        findings.markReadPresent = true;
        findings.markReadEnabled = await markBtn.isEnabled().catch(() => true);

        // Optionally click mark-read on the first comment and record the POST status.
        try {
          auditor.reset();
          await markBtn.click({ timeout: 4000 });
          await settle();
          const snap = auditor.snapshot();
          const post = snap.apiCalls.find(
            (c) => c.method === 'POST' && c.url.includes('/posts/inbox/bulk-read')
          );
          findings.markReadPosted = post ? { status: post.status } : null;
          if (post && post.status >= 400) {
            findings.gaps.push(`bulk-read API ${post.status}`);
            findings.flags.push(`bulk-read-api-${post.status}`);
          }
          if (!post) findings.flags.push('mark-read: no-bulk-read-call');
        } catch (e: any) {
          findings.flags.push('mark-read-click: ' + String(e?.message || e).slice(0, 60));
        }
      } else {
        findings.gaps.push('comments present but no mark-read action');
        findings.flags.push('mark-read: missing');
      }
    } catch (e: any) {
      findings.flags.push('mark-read: exception ' + String(e?.message || e).slice(0, 60));
    }

    // ---- reply control (verify existence + that it opens an input; never send) ----
    try {
      const replyBtn = page.getByRole('button', { name: /reply|respond/i }).first();
      const replyBox = page.getByPlaceholder(/reply|comment|respond|message/i).first();

      const btnVisible = await replyBtn.isVisible({ timeout: 1500 }).catch(() => false);
      const boxVisibleUpfront = await replyBox.isVisible({ timeout: 1000 }).catch(() => false);

      if (btnVisible) {
        findings.replyPresent = true;
        try {
          await replyBtn.click({ timeout: 4000 });
          await page.waitForTimeout(600);
          findings.replyOpensInput =
            (await replyBox.isVisible({ timeout: 1500 }).catch(() => false)) ||
            (await page.getByRole('textbox').count().catch(() => 0)) > 0;
        } catch {
          findings.replyOpensInput = false;
        }
      } else if (boxVisibleUpfront) {
        // Inline reply textbox already present (no separate trigger).
        findings.replyPresent = true;
        findings.replyOpensInput = true;
      } else {
        findings.gaps.push('comments present but no reply action');
        findings.flags.push('reply: missing');
      }
    } catch (e: any) {
      findings.flags.push('reply: exception ' + String(e?.message || e).slice(0, 60));
    }
  } else {
    findings.markReadPresent = false;
    findings.replyPresent = false;
  }

  finish(findings, auditor);
});

// ===== Summarize: write JSON + console, record api/console errors + throttle =====
function finish(findings: any, auditor: PageAuditor) {
  const snap = auditor.snapshot();
  auditor.detach();

  findings.throttled = auditor.hadThrottle();
  if (findings.throttled) findings.flags.push('THROTTLED-429');

  findings.apiErrors = snap.apiErrors.map((c) => ({
    method: c.method,
    url: c.url,
    status: c.status,
  }));
  findings.consoleErrors = snap.consoleErrors.slice(0, 25);
  findings.pageErrors = snap.pageErrors.slice(0, 25);
  findings.failedRequests = snap.failedRequests.slice(0, 25);

  // De-dupe gaps.
  findings.gaps = [...new Set(findings.gaps)];

  findings.summary = {
    commentCount: findings.commentCount,
    emptyStateShown: findings.emptyStateShown,
    filtersPresent: findings.filtersPresent,
    markReadPresent: findings.markReadPresent,
    replyPresent: findings.replyPresent,
    gaps: findings.gaps,
    apiErrorCount: findings.apiErrors.length,
    consoleErrorCount: findings.consoleErrors.length,
    throttled: findings.throttled,
    totalFlags: findings.flags.length,
  };

  try {
    fs.writeFileSync(
      path.join(__dirname, '../results-comments.json'),
      JSON.stringify(findings, null, 2)
    );
  } catch (e: any) {
    console.log('Could not write results-comments.json:', String(e?.message || e));
  }

  console.log('\n===== COMMENT INBOX AUDIT =====');
  console.log(
    `Load: HTTP ${findings.load.status ?? '?'} | textLen ${findings.load.textLen ?? '?'} | auth-redirect ${!!findings.load.redirectedToAuth}`
  );
  console.log(
    `Inbox API: ${findings.load.inboxApi ? findings.load.inboxApi.status + ' ' + (findings.load.inboxApi.query || '') : 'not observed'}`
  );
  console.log(
    `Comments: ${findings.commentCount} | empty-state: ${findings.emptyStateShown} | data-missing: ${findings.dataMissing}`
  );
  console.log(`Filters present: ${findings.filtersPresent.join(', ') || 'none'}`);
  console.log(
    `Unread toggle: found=${findings.unreadToggle.found} refetched=${findings.unreadToggle.refetched} unreadOnly=true=${findings.unreadToggle.withUnreadTrue}`
  );
  console.log(
    `Mark-read: present=${findings.markReadPresent} enabled=${findings.markReadEnabled} posted=${findings.markReadPosted ? findings.markReadPosted.status : '-'}`
  );
  console.log(
    `Reply: present=${findings.replyPresent} opensInput=${findings.replyOpensInput}`
  );
  console.log(`Gaps (${findings.gaps.length}): ${findings.gaps.length ? findings.gaps.join(' | ') : 'none'}`);
  console.log(
    `API errors: ${findings.apiErrors.length} | Console errors: ${findings.consoleErrors.length} | Throttled(429): ${findings.throttled}`
  );
  console.log(`Flags (${findings.flags.length}): ${findings.flags.length ? findings.flags.join(' | ') : 'none'}`);
}
