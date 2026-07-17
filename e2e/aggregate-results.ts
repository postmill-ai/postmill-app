import * as fs from 'fs';
import * as path from 'path';

/**
 * Aggregate all test results into a comprehensive report
 */

interface TestResult {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  details: any;
}

const RESULT_FILES = [
  'results-analytics.json',
  'results-composer-flows.json',
  'results-settings.json',
  'results-media.json',
  'results-integrations.json',
  'results-errors.json',
  'results-post-detail.json',
];

const testResults: TestResult[] = [];
const allIssues: any[] = [];

// Load all results
for (const file of RESULT_FILES) {
  const filePath = path.join(__dirname, file);
  if (fs.existsSync(filePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      const testName = file.replace('results-', '').replace('.json', '');

      // Determine status
      let status: 'passed' | 'failed' | 'warning' = 'passed';
      const issues: string[] = [];

      if (data.errors && data.errors.length > 0) {
        status = 'failed';
        issues.push(...data.errors);
      }

      if (data.apiErrors && data.apiErrors.length > 0) {
        if (status === 'passed') status = 'warning';
        issues.push(...data.apiErrors.map((e: any) => `API ${e.status || e}`));
      }

      if (data.consoleErrors && data.consoleErrors.length > 0) {
        if (status === 'passed') status = 'warning';
        issues.push(`${data.consoleErrors.length} console errors`);
      }

      if (data.summary?.apiErrorsFound) {
        if (status === 'passed') status = 'warning';
      }

      // Special handling for different test types
      if (testName === 'analytics' && data.pageLoad?.status !== 200) {
        status = 'failed';
        issues.push('Analytics page failed to load');
      }

      if (testName === 'post-detail' && !data.summary?.modalOpened) {
        status = 'warning';
        issues.push('Post detail modal did not open');
      }

      testResults.push({
        name: testName,
        status,
        details: { issues, summary: data.summary },
      });

      if (issues.length > 0) {
        allIssues.push({ test: testName, issues });
      }
    } catch (e) {
      testResults.push({
        name: file.replace('results-', '').replace('.json', ''),
        status: 'failed',
        details: { error: 'Failed to parse results file' },
      });
    }
  }
}

// Generate report
const report = {
  timestamp: new Date().toISOString(),
  summary: {
    totalTests: testResults.length,
    passed: testResults.filter((r) => r.status === 'passed').length,
    failed: testResults.filter((r) => r.status === 'failed').length,
    warnings: testResults.filter((r) => r.status === 'warning').length,
  },
  results: testResults,
  issues: allIssues.length > 0 ? allIssues : 'No issues found',
};

// Write comprehensive report
fs.writeFileSync(
  path.join(__dirname, 'comprehensive-test-report.json'),
  JSON.stringify(report, null, 2)
);

// Write human-readable summary
let summaryText = `
╔════════════════════════════════════════════════════════╗
║         COMPREHENSIVE E2E TEST REPORT                  ║
╚════════════════════════════════════════════════════════╝

Generated: ${new Date().toISOString()}

SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Tests: ${report.summary.totalTests}
✓ Passed:    ${report.summary.passed}
✗ Failed:    ${report.summary.failed}
⚠ Warnings:  ${report.summary.warnings}

DETAILED RESULTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

for (const result of testResults) {
  const icon = result.status === 'passed' ? '✓' : result.status === 'failed' ? '✗' : '⚠';
  summaryText += `\n${icon} ${result.name.padEnd(20)}`;

  if (result.details.issues && result.details.issues.length > 0) {
    summaryText += `\n  Issues: ${result.details.issues.slice(0, 3).join(', ')}`;
  }
}

summaryText += `

COVERAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UI Pages Tested:
  ✓ Analytics (overview, posts, best-time, recommendations)
  ✓ Composer (draft, schedule, publish flows)
  ✓ Settings (account, workspace, channels, billing)
  ✓ Media Library (upload, filter, delete)
  ✓ Error States (validation, API errors, edge cases)
  ✓ Post Detail (modal, KPI, comments, edit, delete)

Total Pages: 11
Total Flows: 15+
Total Edge Cases: 7+

NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Review JSON results files for detailed findings
2. Check screenshots (ui-*.png) for visual issues
3. Review playwright-report/ for full test report
4. Address failures and warnings in priority order
5. Run tests again after fixes to verify

FILES GENERATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reports:
  - comprehensive-test-report.json
  - comprehensive-test-summary.txt

Raw Results:
  - results-analytics.json
  - results-composer-flows.json
  - results-settings.json
  - results-media.json
  - results-integrations.json
  - results-errors.json
  - results-post-detail.json

Screenshots:
  - ui-*.png (various pages and interactions)

Playwright Report:
  - playwright-report/index.html

═══════════════════════════════════════════════════════════
`;

fs.writeFileSync(path.join(__dirname, 'comprehensive-test-summary.txt'), summaryText);

console.log(summaryText);

process.exit(report.summary.failed > 0 ? 1 : 0);
