import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Nest reverses the global filter array before matching
 * (RouterExceptionFilters.create → setCustomFilters(filters.reverse())), so
 * the FIRST registered global filter matches LAST. The catch-all
 * SentryReportFilter must therefore be the first useGlobalFilters call in
 * main.ts — registering it later (or as a trailing APP_FILTER provider)
 * shadows every typed filter: ProviderExceptionFilter's 502 envelopes are
 * lost and account-explained upstream 4xx spam Sentry. This has regressed
 * twice; keep it locked.
 */
const mainTs = readFileSync(join(__dirname, '../../main.ts'), 'utf8');
const appModuleTs = readFileSync(join(__dirname, '../../app.module.ts'), 'utf8');

describe('SentryReportFilter registration order', () => {
  it('is the first useGlobalFilters call in main.ts', () => {
    const registrations = [
      ...mainTs.matchAll(/app\.useGlobalFilters\(new (\w+)\(/g),
    ].map((m) => m[1]);
    expect(registrations.length).toBeGreaterThan(0);
    expect(registrations[0]).toBe('SentryReportFilter');
  });

  it('is not registered as an APP_FILTER provider in AppModule', () => {
    const filterBlock = appModuleTs.match(
      /provide:\s*APP_FILTER,\s*useClass:\s*(\w+)/g,
    );
    expect(filterBlock?.join('\n') ?? '').not.toContain('SentryReportFilter');
  });
});
